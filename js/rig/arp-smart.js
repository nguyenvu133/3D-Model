/* ============================================================
 * rig/arp-smart.js — TAB SMART của panel Auto Rig Pro Blend
 * (bản mở rộng "Auto Rig Pro Blend", PHẦN A + MỞ RỘNG SMART)
 *
 * Giữ nguyên pipeline rig của js/rig/auto-rig-pro.js, thêm control
 * giống ARP Blender thật (PHẦN A):
 *   • Guess Markers: đo landmark rồi hiện 7 marker (sphere nhỏ màu)
 *     lên viewport tại vị trí đo được; kéo marker để chỉnh landmark,
 *     rồi bấm "Rig lại" để rig với landmark đã chỉnh.
 *   • Symmetrical Character (mặc định BẬT), Add Neck, Use Markers
 *     Depth, Restore Last Session, Cancel and Delete Markers.
 *
 * MỞ RỘNG SMART (bản này — chỉ sửa file này + css/arp-panel.css,
 * auto-rig-pro.js chỉ cộng thêm opts biến thể skeleton):
 *   • Đặt marker thủ công: chế độ "Place markers" — bấm trực tiếp
 *     lên mesh trong viewport = đặt marker đang chọn tại điểm đó
 *     (raycast lên mesh, snap lên bề mặt mesh = đỉnh mesh gần nhất);
 *     kéo marker để chỉnh; bấm đúp marker để xóa marker đó.
 *     Danh sách 18 marker: chin, neck, chest, groin, L/R shoulder,
 *     elbow, wrist, hip, knee, ankle, toe.
 *   • Bộ marker theo mức: Mặc định (7 marker cũ — chin/groin/
 *     shoulder/2 tay/2 chân, giữ để không phá hành vi cũ), Minimal
 *     (6: chin/groin/2 cổ tay/2 cổ chân), Standard (15 khớp chính),
 *     Full (18: thêm chest + 2 toe). Chọn mức trước khi đặt; nút
 *     "Guess Markers" tự đo tất cả marker của mức đang chọn.
 *     "Snap to surface": chiếu marker lên đỉnh mesh gần nhất.
 *     "Symmetry check": cảnh báo cặp L/R lệch quá 3cm.
 *   • Hỗ trợ đặt marker: mirror khi đặt (mặc định BẬT), snap chân
 *     xuống mặt đất, snap marker cột sống về đường giữa; số đo cơ
 *     thể (cao, dài tay/chân, rộng vai/hông) + slider chỉnh trước
 *     khi rig (slider đổi landmarkOverrides tương ứng).
 *   • Preview skeleton GHOST (cyan, transparent) trước khi rig:
 *     khớp vị trí marker, cập nhật thời gian thực khi kéo marker;
 *     nút "Regenerate" đo lại từ marker, "Rig now" chốt rig thật.
 *   • Tùy chọn rig khi generate: số xương 41 Mixamo / 28 kiểu HY3D
 *     / tối giản 15; bật/tắt ngón tay, ngón chân, twist bone, số đốt
 *     sống (1/2/3), số đốt cổ (1/2); tư thế gốc T-pose / A-pose.
 *     (xem AutoRigPro.variantBoneDefs — buildSkeleton gốc không đổi
 *     hành vi mặc định: vẫn 41 xương khi không truyền opts mới.)
 *   • Session/marker set: tự lưu marker + setting vào localStorage
 *     `pixistudio.arp-smart` mỗi khi thay đổi; xuất/nhập marker set
 *     ra file JSON; lưu nhiều marker set đặt tên được (key
 *     `pixistudio.arp-smart-sets`).
 *   • Mesh không phải humanoid: đo độ tin cậy (cằm/groin/vai/tay/
 *     hông đo được); thấp → cảnh báo + chuyển "Manual marker mode"
 *     (tắt Guess Markers, chỉ đặt tay). KHÔNG làm rig quadruped.
 *
 * CHẶN ORBIT KHI ĐẶT/KÉO MARKER: viewport dùng OrbitCam tự viết
 * (js/viewport/camera.js) có cờ `enabled` — orbit()/pan()/zoom()
 * đều kiểm tra cờ này. Khi bật Place markers thì đặt
 * Viewport.orbit.enabled=false cho tới khi tắt; khi kéo marker thì
 * tắt từ pointerdown tới pointerup. Nhờ vậy camera không xoay theo
 * khi đặt/kéo marker (khác ghi chú cũ ở _bindDrag: trước đây chưa
 * có cách chặn này nên camera vẫn xoay nhẹ).
 * HẠN CHẾ BIẾT TRƯỚC (ghi rõ):
 *   • Marker đặt bằng raycast/đỉnh gần nhất trên mesh THẬT, không
 *     phải AI nhận diện như ARP Blender thật; mesh phải load được
 *     và có geometry thì mới đặt/snap được.
 *   • Ghost preview chỉ là hiển thị (đường nối + khớp tròn cyan),
 *     không phải rig thật cho tới khi bấm Rig now.
 *   • Mirror/snap chỉ đúng khi mesh gần đối xứng qua trục X và
 *     đứng thẳng (trục Y là trục đứng, mặt hướng +Z như pipeline đo).
 *   • A-pose chỉ là xấp xỉ hình học từ marker tay (tay khép vào +
 *     hạ thấp), không đo lại tư thế thật của mesh.
 * ============================================================ */
(function () {
  'use strict';

  var bus = PixiStudio.bus;

  var STORAGE_KEY = 'pixistudio.arp-smart';
  var SETS_KEY = 'pixistudio.arp-smart-sets';
  var SYMMETRY_THRESHOLD_M = 0.03;   /* 3cm — ngưỡng cảnh báo lệch L/R */

  var ArpSmart = {
    landmarks: null,       /* landmark đã đo (gốc, chưa ghi đè) */
    overrides: null,       /* { chinY, groinY, ... } hoặc null */
    settings: { symmetrical: true, addNeck: false, useDepth: false },
    markers: [],           /* { id, label, landmarkKey, xKey, yOffset, zOffset, mirror, mesh, position } */
    markerGroup: null,
    target: null,
    dragging: null,
    _dragBound: null,
    _container: null,
    markerLevel: null,     /* null = mặc định 7 marker cũ; 'minimal' | 'standard' | 'full' */
    selectedMarkerId: 'chin',
    placeMode: false,
    mirrorEnabled: true,
    manualMode: false,
    humanoidCheck: null,
    rigOpts: { boneCount: 41, fingers: true, toes: true, twist: false, spineSegments: 3, neckSegments: 1, pose: 'T',
      /* NHÓM 6 — Animal presets: 'humanoid' | 'quadruped' | 'robot' | 'bird'
         (xem js/rig/arp-animal-presets.js). Mặc định humanoid = hành vi cũ. */
      preset: 'humanoid' },
    /* [NHÓM 1 — Decimation/Shape 2026-11-27] Tùy chọn decimate trước
       khi rig + kết quả phân tích hình dạng / rig plan / decimate
       gần nhất (xem js/rig/arp-decimate.js). */
    decimateOpts: { enabled: false, ratio: 0.32, protectJoints: true },
    lastShapeAnalysis: null,
    lastRigPlan: null,
    lastDecimate: null,
    lastDecimateTarget: null,
    ghost: { group: null, joints: {}, jointPositions: {}, pairs: [], lines: null, visible: false },
    lastSymmetry: null,
    _orbitOff: false
  };
  ArpSmart.STORAGE_KEY = STORAGE_KEY;
  ArpSmart.SETS_KEY = SETS_KEY;
  ArpSmart.SYMMETRY_THRESHOLD_M = SYMMETRY_THRESHOLD_M;

  function notify(type, title, message, duration) {
    if (bus && bus.emit) bus.emit('notify', { type: type, title: title, message: message, duration: duration || 8000 });
  }

  function getTarget(target) {
    if (target) return target;
    if (PixiStudio.State && PixiStudio.State.get) {
      var sel = PixiStudio.State.get('selection');
      if (sel) return sel;
    }
    if (PixiStudio.Viewport && PixiStudio.Viewport.getMainModel) return PixiStudio.Viewport.getMainModel();
    return null;
  }

  function getScene() {
    if (PixiStudio.Viewport && PixiStudio.Viewport.scene) return PixiStudio.Viewport.scene;
    return null;
  }

  function getCamera() {
    if (PixiStudio.Viewport && PixiStudio.Viewport.orbit && PixiStudio.Viewport.orbit.camera) return PixiStudio.Viewport.orbit.camera;
    return null;
  }

  function getCanvas() {
    if (typeof document === 'undefined') return null;
    return document.getElementById('three-canvas') || null;
  }

  /* OrbitCam tự viết (js/viewport/camera.js) có cờ `enabled` — xem
     ghi chú chặn orbit ở đầu file. */
  function getOrbit() {
    if (PixiStudio.Viewport && PixiStudio.Viewport.orbit) return PixiStudio.Viewport.orbit;
    return null;
  }
  ArpSmart._setOrbitEnabled = function (on) {
    var o = getOrbit();
    if (o && typeof o.enabled !== 'undefined') o.enabled = !!on;
  };

  function collectMeshes(root) {
    var out = [];
    if (!root || !root.traverse) return out;
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isArpMarker || o.userData.isArpGhost || o.userData.isBoneVisual || o.userData.skipSkin)) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      out.push(o);
    });
    return out;
  }

  /* ---------- Định nghĩa marker ----------
     yOff/zOff: tỉ lệ theo H (âm = thấp hơn mốc landmark). Khi kéo/
     đặt marker, landmark tương ứng = markerY - yOffset (yOffset tuyệt
     đối = yOff * H). mirror: id marker đối xứng qua trục X. */
  var MARKER_COLORS = {
    chin: 0xffd166, groin: 0x06d6a0, shoulder: 0x118ab2,
    LeftHand: 0xef476f, RightHand: 0xf78c6b,
    LeftFoot: 0x7b61ff, RightFoot: 0x4cc9f0
  };
  var ALL_MARKER_DEFS = [
    { id: 'chin', label: 'Cằm (chin)', landmarkKey: 'chinY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0xffd166 },
    { id: 'neck', label: 'Cổ (neck)', landmarkKey: 'chinY', xKey: null, yOff: -0.05, zOff: 0, mirror: null, color: 0xffc300 },
    { id: 'chest', label: 'Ngực (chest)', landmarkKey: 'shoulderY', xKey: null, yOff: -0.08, zOff: 0.005, mirror: null, color: 0x118ab2 },
    { id: 'groin', label: 'Háng (groin)', landmarkKey: 'groinY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0x06d6a0 },
    { id: 'shoulder', label: 'Vai (shoulder)', landmarkKey: 'shoulderY', xKey: null, yOff: 0, zOff: 0, mirror: null, color: 0x118ab2 },
    { id: 'LeftShoulder', label: 'Vai trái', landmarkKey: 'shoulderY', xKey: 'shoulderWidth', yOff: 0, zOff: 0, mirror: 'RightShoulder', color: 0x118ab2 },
    { id: 'RightShoulder', label: 'Vai phải', landmarkKey: 'shoulderY', xKey: 'shoulderWidth', yOff: 0, zOff: 0, mirror: 'LeftShoulder', color: 0x118ab2 },
    { id: 'LeftElbow', label: 'Khuỷu trái', landmarkKey: 'elbowY', xKey: 'foreX', yOff: 0, zOff: 0.005, mirror: 'RightElbow', color: 0xef476f },
    { id: 'RightElbow', label: 'Khuỷu phải', landmarkKey: 'elbowY', xKey: 'foreX', yOff: 0, zOff: 0.005, mirror: 'LeftElbow', color: 0xef476f },
    { id: 'LeftWrist', label: 'Cổ tay trái', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'RightWrist', color: 0xef476f },
    { id: 'RightWrist', label: 'Cổ tay phải', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'LeftWrist', color: 0xef476f },
    { id: 'LeftHand', label: 'Tay trái', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'RightHand', color: 0xef476f },
    { id: 'RightHand', label: 'Tay phải', landmarkKey: 'wristY', xKey: 'handX', yOff: 0, zOff: 0.01, mirror: 'LeftHand', color: 0xf78c6b },
    { id: 'LeftHip', label: 'Hông trái', landmarkKey: 'groinY', xKey: 'hipX', yOff: 0, zOff: 0, mirror: 'RightHip', color: 0x7b61ff },
    { id: 'RightHip', label: 'Hông phải', landmarkKey: 'groinY', xKey: 'hipX', yOff: 0, zOff: 0, mirror: 'LeftHip', color: 0x7b61ff },
    { id: 'LeftKnee', label: 'Gối trái', landmarkKey: 'kneeY', xKey: 'hipX', yOff: 0, zOff: 0.005, mirror: 'RightKnee', color: 0x7b61ff },
    { id: 'RightKnee', label: 'Gối phải', landmarkKey: 'kneeY', xKey: 'hipX', yOff: 0, zOff: 0.005, mirror: 'LeftKnee', color: 0x7b61ff },
    { id: 'LeftAnkle', label: 'Mắt cá trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'RightAnkle', color: 0x4cc9f0 },
    { id: 'RightAnkle', label: 'Mắt cá phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'LeftAnkle', color: 0x4cc9f0 },
    { id: 'LeftFoot', label: 'Chân trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'RightFoot', color: 0x7b61ff },
    { id: 'RightFoot', label: 'Chân phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: 0, zOff: 0.01, mirror: 'LeftFoot', color: 0x4cc9f0 },
    { id: 'LeftToe', label: 'Ngón chân trái', landmarkKey: 'ankleY', xKey: 'hipX', yOff: -0.008, zOff: 0.06, mirror: 'RightToe', color: 0x4cc9f0 },
    { id: 'RightToe', label: 'Ngón chân phải', landmarkKey: 'ankleY', xKey: 'hipX', yOff: -0.008, zOff: 0.06, mirror: 'LeftToe', color: 0x4cc9f0 }
  ];
  var LEGACY_IDS = ['chin', 'groin', 'shoulder', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'];
  var LEVELS = {
    minimal: ['chin', 'groin', 'LeftWrist', 'RightWrist', 'LeftAnkle', 'RightAnkle'],
    standard: ['chin', 'neck', 'groin',
      'LeftShoulder', 'RightShoulder', 'LeftElbow', 'RightElbow',
      'LeftWrist', 'RightWrist', 'LeftHip', 'RightHip',
      'LeftKnee', 'RightKnee', 'LeftAnkle', 'RightAnkle'],
    full: ['chin', 'neck', 'chest', 'groin',
      'LeftShoulder', 'RightShoulder', 'LeftElbow', 'RightElbow',
      'LeftWrist', 'RightWrist', 'LeftHip', 'RightHip',
      'LeftKnee', 'RightKnee', 'LeftAnkle', 'RightAnkle',
      'LeftToe', 'RightToe']
  };
  var SPINE_MARKER_IDS = ['chin', 'neck', 'chest', 'groin', 'shoulder'];
  var GROUND_MARKER_IDS = ['LeftAnkle', 'RightAnkle', 'LeftFoot', 'RightFoot', 'LeftToe', 'RightToe'];

  function lookupMarkerDef(id, lm) {
    for (var i = 0; i < ALL_MARKER_DEFS.length; i++) {
      if (ALL_MARKER_DEFS[i].id !== id) continue;
      var d = ALL_MARKER_DEFS[i];
      var H = lm ? lm.H : 1.8;
      return {
        id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey,
        yOffset: (d.yOff || 0) * H, zOffset: (d.zOff || 0) * H,
        mirror: d.mirror || null, color: d.color,
        position: lm ? markerPositionFromLandmarks({ id: d.id, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: (d.yOff || 0) * H, zOffset: (d.zOff || 0) * H }, lm) : { x: 0, y: 0, z: 0 }
      };
    }
    return null;
  }

  /* Vị trí marker từ landmark (dùng lại công thức của
     AutoRigPro.guessMarkers để Restore không cần đo lại mesh).
     Marker có xKey đặt ở cx ± lm[xKey] (trái âm, phải dương theo id);
     marker không xKey đặt ở cx; y = lm[landmarkKey] + yOffset. */
  function markerPositionFromLandmarks(def, lm) {
    var cx = lm.cx, cz = lm.cz;
    var x = cx;
    if (def.xKey) {
      var sgn = def.id.indexOf('Left') === 0 ? -1 : 1;
      x = cx + sgn * lm[def.xKey];
    }
    return { x: x, y: lm[def.landmarkKey] + (def.yOffset || 0), z: cz + (def.zOffset || 0) };
  }

  function positionsFromLandmarks(lm) {
    return LEGACY_IDS.map(function (id) {
      var d = lookupMarkerDef(id, lm);
      return { id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: d.yOffset, zOffset: d.zOffset, mirror: d.mirror, color: d.color, position: d.position };
    });
  }
  ArpSmart.positionsFromLandmarks = positionsFromLandmarks;

  function positionsFromLandmarks17(lm) {
    return ALL_MARKER_DEFS.filter(function (d) { return LEVELS.full.indexOf(d.id) >= 0; })
      .map(function (d) {
        var def = lookupMarkerDef(d.id, lm);
        return { id: def.id, label: def.label, landmarkKey: def.landmarkKey, xKey: def.xKey, yOffset: def.yOffset, zOffset: def.zOffset, mirror: def.mirror, color: def.color, position: def.position };
      });
  }
  ArpSmart.positionsFromLandmarks17 = positionsFromLandmarks17;

  function levelDefs(level, lm) {
    var ids = LEVELS[level];
    if (!ids) return null;
    return ids.map(function (id) {
      var d = lookupMarkerDef(id, lm);
      return { id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: d.yOffset, zOffset: d.zOffset, mirror: d.mirror, color: d.color, position: d.position };
    });
  }
  ArpSmart.levelDefs = levelDefs;
  ArpSmart.LEVELS = LEVELS;
  ArpSmart.MARKER_IDS_FULL = LEVELS.full.slice();
  ArpSmart.MARKER_IDS_17 = ArpSmart.MARKER_IDS_FULL;   /* alias cũ (thực ra 18 marker) */

  /* Landmark đã áp overrides (để hiện marker đúng vị trí đã chỉnh). */
  function effectiveLandmarks() {
    if (!ArpSmart.landmarks) return null;
    var lm = Object.assign({}, ArpSmart.landmarks);
    if (ArpSmart.overrides) {
      Object.keys(ArpSmart.overrides).forEach(function (k) { lm[k] = ArpSmart.overrides[k]; });
    }
    return lm;
  }

  /* ---------- Marker 3D ---------- */
  function showMarkers(defs, target) {
    if (!window.THREE) { notify('error', 'Tab Smart', 'THREE chưa sẵn sàng — không hiện được marker.'); return false; }
    var scene = getScene();
    if (!scene) {
      /* Không có viewport scene (vd chạy harness không có Viewport):
         vẫn giữ defs để test logic kéo marker, chỉ không có mesh. */
      ArpSmart.markers = defs.map(function (d) {
        return { id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: d.yOffset || 0, zOffset: d.zOffset || 0, mirror: d.mirror || null, mesh: null, position: d.position };
      });
      ArpSmart._highlightSelected();
      return true;
    }
    ArpSmart.clearMarkers();
    var H = (ArpSmart.landmarks && ArpSmart.landmarks.H) || 1.8;
    var radius = Math.max(0.008, H * 0.02);
    var group = new THREE.Group();
    group.name = '__arp_markers__';
    ArpSmart.markers = defs.map(function (d) {
      var geo = new THREE.SphereGeometry(radius, 16, 12);
      var mat = new THREE.MeshBasicMaterial({ color: d.color, depthTest: false, transparent: true, opacity: 0.9 });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(d.position.x, d.position.y, d.position.z);
      mesh.renderOrder = 999;
      mesh.userData.isArpMarker = true;
      mesh.userData.markerId = d.id;
      group.add(mesh);
      return { id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: d.yOffset || 0, zOffset: d.zOffset || 0, mirror: d.mirror || null, mesh: mesh, position: d.position };
    });
    ArpSmart.markerGroup = group;
    scene.add(group);
    ArpSmart._bindDrag();
    ArpSmart._highlightSelected();
    return true;
  }

  ArpSmart.clearMarkers = function () {
    if (ArpSmart.markerGroup) {
      var scene = getScene();
      if (scene) scene.remove(ArpSmart.markerGroup);
      ArpSmart.markerGroup.traverse(function (o) {
        if (o.isMesh) {
          if (o.geometry && o.geometry.dispose) o.geometry.dispose();
          if (o.material && o.material.dispose) o.material.dispose();
        }
      });
      ArpSmart.markerGroup = null;
    }
    ArpSmart.markers = [];
    ArpSmart.dragging = null;
  };

  /* Marker đang chọn: to hơn (scale 1.4) để nhận ra trong viewport. */
  ArpSmart._highlightSelected = function () {
    ArpSmart.markers.forEach(function (m) {
      if (!m.mesh) return;
      var s = (m.id === ArpSmart.selectedMarkerId) ? 1.4 : 1.0;
      m.mesh.scale.set(s, s, s);
    });
  };

  ArpSmart.selectMarker = function (id) {
    var found = false;
    for (var i = 0; i < ArpSmart.markers.length; i++) {
      if (ArpSmart.markers[i].id === id) { found = true; break; }
    }
    if (!found && !lookupMarkerDef(id, ArpSmart.landmarks)) return false;
    ArpSmart.selectedMarkerId = id;
    ArpSmart._highlightSelected();
    ArpSmart.refreshReadout();
    return true;
  };

  ArpSmart.removeMarker = function (id) {
    var idx = -1;
    for (var i = 0; i < ArpSmart.markers.length; i++) {
      if (ArpSmart.markers[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return false;
    var m = ArpSmart.markers[idx];
    if (m.mesh && ArpSmart.markerGroup) {
      ArpSmart.markerGroup.remove(m.mesh);
      if (m.mesh.geometry && m.mesh.geometry.dispose) m.mesh.geometry.dispose();
      if (m.mesh.material && m.mesh.material.dispose) m.mesh.material.dispose();
    }
    ArpSmart.markers.splice(idx, 1);
    if (ArpSmart.selectedMarkerId === id) ArpSmart.selectedMarkerId = ArpSmart.markers.length ? ArpSmart.markers[0].id : 'chin';
    ArpSmart.updateGhost();
    ArpSmart.saveSession();
    ArpSmart.refreshReadout();
    return true;
  };

  /* Thêm 1 marker vào danh sách hiện tại (dùng khi đặt thủ công 1
     marker chưa có trong mức đang chọn): dựng lại toàn bộ marker
     mesh từ defs hiện tại + def mới, giữ nguyên vị trí đã có. */
  function addMarkerDef(id) {
    var def = lookupMarkerDef(id, ArpSmart.landmarks);
    if (!def) return null;
    var defs = ArpSmart.markers.map(function (m) {
      var p = m.mesh ? { x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z } : (m.position || { x: 0, y: 0, z: 0 });
      return { id: m.id, label: m.label, landmarkKey: m.landmarkKey, xKey: m.xKey, yOffset: m.yOffset || 0, zOffset: m.zOffset || 0, mirror: m.mirror || null, color: (m.mesh ? m.mesh.material.color.getHex() : 0x888888), position: p };
    });
    defs.push({ id: def.id, label: def.label, landmarkKey: def.landmarkKey, xKey: def.xKey, yOffset: def.yOffset, zOffset: def.zOffset, mirror: def.mirror, color: def.color, position: def.position });
    showMarkers(defs, ArpSmart.target);
    return def;
  }
  ArpSmart._addMarker = addMarkerDef;

  /* ---------- Phát hiện humanoid (độ tin cậy) ----------
     5 tiêu chí từ measured flags của AutoRigPro.measureLandmarks:
     chin (tìm được cổ thắt), groin (tìm được điểm tách 2 chân),
     shoulderWidth, tay (handX hoặc armX), hipX (tâm 2 cụm chân).
     humanoid khi điểm >= 0.7 VÀ tách được 2 chân VÀ có tay.
     Trên lenhhosung thật: chin rơi về fallback (0) nhưng 4/5 còn lại
     đo được → 0.8 → humanoid. Trên box/cylinder đặc: chin + groin
     đều không đo được → 0.6 → KHÔNG humanoid. Mesh chỉ 1 chân:
     groin + hipX đều mất → <= 0.4 → KHÔNG humanoid. */
  ArpSmart.detectHumanoid = function (targetOrLm) {
    var ARP = PixiStudio.AutoRigPro;
    var lm = null;
    if (targetOrLm && typeof targetOrLm.H === 'number') lm = targetOrLm;
    else if (targetOrLm && ARP && ARP.measureLandmarks) lm = ARP.measureLandmarks(targetOrLm);
    else lm = ArpSmart.landmarks;
    if (!lm) return { humanoid: false, confidence: 0, score: 0, total: 5, reasons: ['Không đo được landmark — model rỗng hoặc không có mesh.'], flags: {}, arms: 0, legs: 0 };
    var md = lm.measured || {};
    var flags = {
      chin: !!md.chin,
      groin: !!md.groin,
      shoulderWidth: !!md.shoulderWidth,
      handX: !!(md.handX || md.armX),
      hipX: !!md.hipX
    };
    var score = 0;
    Object.keys(flags).forEach(function (k) { if (flags[k]) score++; });
    var reasons = [];
    if (!flags.chin) reasons.push('Không tìm được cằm/cổ thắt (chin đo yếu, rơi về tỉ lệ 0.85H).');
    if (!flags.groin) reasons.push('Không tìm được điểm tách 2 chân (groin) — có thể chỉ có 1 chân hoặc thân dưới là khối liền.');
    if (!flags.shoulderWidth) reasons.push('Không đo được rộng vai.');
    if (!flags.handX) reasons.push('Không đo được tay (không có cực trị |x| ở dải vai/cổ tay).');
    if (!flags.hipX) reasons.push('Không đo được tâm 2 cụm chân (hipX).');
    var humanoid = (score / 5) >= 0.7 && flags.groin && flags.handX;
    return {
      humanoid: humanoid, confidence: score / 5, score: score, total: 5,
      reasons: reasons, flags: flags,
      arms: flags.handX ? 2 : 0, legs: flags.hipX ? 2 : 0
    };
  };

  ArpSmart.setManualMode = function (on, reason) {
    ArpSmart.manualMode = !!on;
    if (on) ArpSmart.placeMode = false;
    ArpSmart._setOrbitEnabled(true);
    ArpSmart.saveSession();
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    if (on) notify('warning', 'Manual marker mode',
      'Chỉ đặt marker thủ công — Guess Markers đã tắt. ' + (reason || 'Mesh không giống humanoid rõ ràng.'), 12000);
    return ArpSmart.manualMode;
  };

  /* ---------- Guess Markers (theo mức) ---------- */
  function doGuess(target, level) {
    var ARP = PixiStudio.AutoRigPro;
    if (!ARP || !ARP.guessMarkers) { notify('error', 'Tab Smart', 'AutoRigPro chưa sẵn sàng.'); return null; }
    target = getTarget(target);
    if (!target) { notify('warning', 'Tab Smart', 'Chưa có model nào — load model trước rồi bấm Guess Markers.'); return null; }
    if (ArpSmart.manualMode) {
      notify('warning', 'Tab Smart', 'Đang ở Manual marker mode — Guess Markers đã tắt, chỉ đặt marker thủ công. Bấm “Thoát Manual mode” để đo lại.');
      return null;
    }
    var guess = ARP.guessMarkers(target);
    if (!guess) { notify('error', 'Tab Smart', 'Không đo được landmark — model rỗng hoặc không có mesh.'); return null; }
    ArpSmart.target = target;
    ArpSmart.landmarks = guess.landmarks;
    ArpSmart.overrides = null;
    var hc = ArpSmart.detectHumanoid(guess.landmarks);
    ArpSmart.humanoidCheck = hc;
    if (!hc.humanoid) {
      ArpSmart.manualMode = true;
      ArpSmart.clearMarkers();
      ArpSmart.hideGhost();
      ArpSmart.saveSession();
      ArpSmart.refreshReadout();
      notify('warning', 'Mesh không giống humanoid rõ ràng',
        'Độ tin cậy ' + (hc.confidence * 100).toFixed(0) + '% (' + hc.score + '/' + hc.total + '): ' + hc.reasons.join(' ') +
        ' Đã chuyển sang Manual marker mode — chỉ đặt marker thủ công, Guess Markers đã tắt.', 15000);
      return { landmarks: guess.landmarks, markers: [], humanoid: hc };
    }
    ArpSmart.manualMode = false;
    var defs = level ? levelDefs(level, guess.landmarks) : positionsFromLandmarks(guess.landmarks);
    showMarkers(defs, target);
    ArpSmart.saveSession();
    ArpSmart.refreshReadout();
    var lm = guess.landmarks;
    notify('success', 'Guess Markers xong',
      'Đã đo ' + defs.length + ' marker' + (level ? ' (mức ' + level + ')' : ' (mặc định 7)') +
      ' · cằm ' + ((lm.chinY - lm.groundY) / lm.H).toFixed(2) + 'H · háng ' +
      ((lm.groinY - lm.groundY) / lm.H).toFixed(2) + 'H · kéo marker để chỉnh, rồi bấm Rig lại.', 10000);
    return { landmarks: guess.landmarks, markers: defs, humanoid: hc };
  }

  ArpSmart.guessMarkers = function (target) {
    return doGuess(target, ArpSmart.markerLevel);
  };

  ArpSmart.guessMarkersLevel = function (level, target) {
    if (!LEVELS[level]) { notify('warning', 'Tab Smart', 'Mức marker lạ: ' + level + ' (minimal / standard / full).'); return null; }
    ArpSmart.markerLevel = level;
    return doGuess(target, level);
  };

  ArpSmart.setMarkerLevel = function (level) {
    if (level !== null && level !== undefined && !LEVELS[level]) return false;
    ArpSmart.markerLevel = level || null;
    ArpSmart.saveSession();
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    return true;
  };

  /* ---------- Kéo / đặt marker → cập nhật overrides ----------
     Kéo dọc đổi landmark Y (landmarkKey = markerY - yOffset); kéo
     ngang đổi landmark X (xKey: handX/hipX/... = |x - cx|).
     Trả về overrides hiện tại. */
  function applyMarkerPosition(id, newPos) {
    if (!ArpSmart.landmarks) return null;
    var def = null;
    for (var i = 0; i < ArpSmart.markers.length; i++) {
      if (ArpSmart.markers[i].id === id) { def = ArpSmart.markers[i]; break; }
    }
    if (!def) return null;
    var lm = ArpSmart.landmarks;
    var H = lm.H;
    var yOff = def.yOffset || 0;
    var lmY = Math.max(lm.groundY, Math.min(lm.headTopY, newPos.y - yOff));
    if (!ArpSmart.overrides) ArpSmart.overrides = {};
    ArpSmart.overrides[def.landmarkKey] = lmY;
    if (def.xKey) {
      var dx = Math.max(0.005 * H, Math.min(0.8 * H, Math.abs(newPos.x - lm.cx)));
      ArpSmart.overrides[def.xKey] = dx;
    }
    var mp = { x: newPos.x, y: lmY + yOff, z: newPos.z };
    if (def.mesh) def.mesh.position.set(mp.x, mp.y, mp.z);
    def.position = mp;
    return mp;
  }

  ArpSmart.applyMarkerDrag = function (id, newPos) {
    var mp = applyMarkerPosition(id, newPos);
    if (!mp) return null;
    ArpSmart.refreshReadout();
    ArpSmart.updateGhost();
    ArpSmart.saveSession();
    return ArpSmart.overrides;
  };

  /* Đỉnh mesh gần nhất (world) với 1 điểm — dùng để snap marker lên
     bề mặt mesh. Trả về { point, distance } hoặc null khi không có mesh. */
  function nearestVertexOnMesh(point, target) {
    if (!target || !target.traverse || !window.THREE) return null;
    target.updateMatrixWorld(true);
    var best = null, bestD = Infinity;
    var v = new THREE.Vector3();
    target.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData && (o.userData.isArpMarker || o.userData.isArpGhost || o.userData.isBoneVisual || o.userData.skipSkin)) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      var pos = o.geometry.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        var dx = v.x - point.x, dy = v.y - point.y, dz = v.z - point.z;
        var d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = { x: v.x, y: v.y, z: v.z }; }
      }
    });
    if (!best) return null;
    return { point: best, distance: Math.sqrt(bestD) };
  }
  ArpSmart.nearestVertexOnMesh = nearestVertexOnMesh;

  /* Đặt marker thủ công tại 1 điểm (world). Mặc định snap lên bề
     mặt mesh (đỉnh gần nhất); mirror đặt luôn marker đối xứng;
     marker cột sống snap x=cx khi đặt gần giữa; marker chân snap
     y=groundY khi đặt gần đất. Trả về { id, position, snapped,
     snapDistance, mirrored } hoặc null. */
  ArpSmart.placeMarker = function (id, point, opts) {
    opts = opts || {};
    var ARP = PixiStudio.AutoRigPro;
    var def = lookupMarkerDef(id, ArpSmart.landmarks);
    if (!def) { notify('warning', 'Tab Smart', 'Marker lạ: ' + id); return null; }
    if (!ArpSmart.landmarks) {
      var t0 = getTarget(ArpSmart.target);
      if (t0 && ARP && ARP.measureLandmarks) {
        var lm0 = ARP.measureLandmarks(t0);
        if (lm0) { ArpSmart.target = t0; ArpSmart.landmarks = lm0; }
      }
      if (!ArpSmart.landmarks) { notify('warning', 'Tab Smart', 'Chưa đo landmark — bấm Guess Markers trước rồi đặt marker thủ công.'); return null; }
    }
    var target = getTarget(ArpSmart.target);
    var p = { x: point.x, y: point.y, z: point.z };
    var snapped = false, snapDistance = null;
    if (opts.snap !== false && target) {
      var nv = nearestVertexOnMesh(p, target);
      if (nv) { p = { x: nv.point.x, y: nv.point.y, z: nv.point.z }; snapped = true; snapDistance = nv.distance; }
    }
    var lm = ArpSmart.landmarks, H = lm.H;
    if (SPINE_MARKER_IDS.indexOf(id) >= 0 && Math.abs(p.x - lm.cx) < 0.05 * H) p.x = lm.cx;
    if (GROUND_MARKER_IDS.indexOf(id) >= 0 && (p.y - lm.groundY) < 0.03 * H) p.y = lm.groundY;
    var exists = false;
    for (var i = 0; i < ArpSmart.markers.length; i++) {
      if (ArpSmart.markers[i].id === id) { exists = true; break; }
    }
    if (!exists) addMarkerDef(id);
    var mp = applyMarkerPosition(id, p);
    if (!mp) return null;
    var mirrored = false;
    if (ArpSmart.mirrorEnabled && opts.mirror !== false && def.mirror) {
      /* Mirror đặt đúng điểm đối xứng (snap:false) để cặp L/R đối
         xứng chính xác qua cx; snap bề mặt có thể lệch vài mm-cm do
         đỉnh mesh 2 bên không hoàn toàn đối xứng — user bấm Snap to
         surface sau nếu cần. */
      var res2 = ArpSmart.placeMarker(def.mirror, { x: 2 * lm.cx - mp.x, y: mp.y, z: mp.z }, { snap: false, mirror: false });
      mirrored = !!res2;
    }
    ArpSmart.selectedMarkerId = id;
    ArpSmart._highlightSelected();
    ArpSmart.refreshReadout();
    ArpSmart.updateGhost();
    ArpSmart.saveSession();
    return { id: id, position: mp, snapped: snapped, snapDistance: snapDistance, mirrored: mirrored };
  };

  /* Đặt marker bằng tia raycast (vd từ camera qua điểm bấm trên màn
     hình): giao điểm đầu tiên với mesh → placeMarker (snap). */
  ArpSmart.placeMarkerFromRay = function (id, origin, direction, target) {
    if (!window.THREE) return null;
    target = getTarget(target || ArpSmart.target);
    if (!target) { notify('warning', 'Tab Smart', 'Chưa có model nào để đặt marker.'); return null; }
    var meshes = collectMeshes(target);
    if (!meshes.length) return null;
    var raycaster = new THREE.Raycaster();
    var dir = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (dir.lengthSq() < 1e-12) return null;
    dir.normalize();
    raycaster.set(new THREE.Vector3(origin.x, origin.y, origin.z), dir);
    var hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    var res = ArpSmart.placeMarker(id, { x: hits[0].point.x, y: hits[0].point.y, z: hits[0].point.z }, { snap: true });
    if (res) res.rayDistance = hits[0].distance;
    return res;
  };

  /* Snap marker lên bề mặt mesh (đỉnh gần nhất). */
  ArpSmart.snapMarkerToSurface = function (id) {
    var target = getTarget(ArpSmart.target);
    if (!target) return null;
    var m = null;
    for (var i = 0; i < ArpSmart.markers.length; i++) {
      if (ArpSmart.markers[i].id === id) { m = ArpSmart.markers[i]; break; }
    }
    if (!m) return null;
    var p = m.mesh ? { x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z } : m.position;
    var nv = nearestVertexOnMesh(p, target);
    if (!nv) return null;
    var mp = applyMarkerPosition(id, nv.point);
    if (!mp) return null;
    ArpSmart.refreshReadout();
    ArpSmart.updateGhost();
    ArpSmart.saveSession();
    return { id: id, position: mp, snapDistance: nv.distance };
  };

  ArpSmart.snapAllMarkersToSurface = function () {
    var out = [];
    ArpSmart.markers.slice().forEach(function (m) {
      var r = ArpSmart.snapMarkerToSurface(m.id);
      if (r) out.push(r);
    });
    return out;
  };

  /* ---------- Symmetry check ----------
     So sánh cặp L/R: |x_left - cx| vs |x_right - cx| (dxErr) và
     |y_left - y_right| (dyErr). Lệch quá ngưỡng (mặc định 3cm) thì
     liệt kê vào badPairs. */
  var SYMM_MARKER_PAIRS = [
    ['LeftShoulder', 'RightShoulder'], ['LeftElbow', 'RightElbow'],
    ['LeftWrist', 'RightWrist'], ['LeftHand', 'RightHand'],
    ['LeftHip', 'RightHip'], ['LeftKnee', 'RightKnee'],
    ['LeftAnkle', 'RightAnkle'], ['LeftFoot', 'RightFoot'],
    ['LeftToe', 'RightToe']
  ];
  ArpSmart.checkSymmetry = function (thresholdM) {
    var th = (thresholdM != null) ? thresholdM : SYMMETRY_THRESHOLD_M;
    var byId = {};
    ArpSmart.markers.forEach(function (m) {
      var p = m.mesh ? m.mesh.position : (m.position || { x: 0, y: 0, z: 0 });
      byId[m.id] = p;
    });
    var cx = ArpSmart.landmarks ? ArpSmart.landmarks.cx : 0;
    var pairs = [], badPairs = [];
    SYMM_MARKER_PAIRS.forEach(function (pr) {
      var L = byId[pr[0]], R = byId[pr[1]];
      if (!L || !R) return;
      var dxErr = Math.abs(Math.abs(L.x - cx) - Math.abs(R.x - cx));
      var dyErr = Math.abs(L.y - R.y);
      var bad = dxErr > th || dyErr > th;
      var row = { pair: pr[0] + ' / ' + pr[1], dxErr: dxErr, dyErr: dyErr, bad: bad };
      pairs.push(row);
      if (bad) badPairs.push(row);
    });
    var res = { ok: badPairs.length === 0, threshold: th, pairs: pairs, badPairs: badPairs, checked: pairs.length };
    ArpSmart.lastSymmetry = res;
    return res;
  };

  /* ---------- Số đo cơ thể + slider ----------
     height: H; armLength: |vai→cổ tay| (đường thẳng); legLength:
     groinY - groundY; shoulderWidth: 2×shoulderWidth; hipWidth:
     2×hipX; armReach: handX (|x cổ tay - cx|).
     setMeasurement đổi landmarkOverrides tương ứng rồi đặt lại vị
     trí marker + ghost (không đo lại mesh). */
  ArpSmart.computeMeasurements = function () {
    var lm = effectiveLandmarks();
    if (!lm) return null;
    var dxArm = Math.max(0, lm.handX - lm.shoulderWidth);
    var dyArm = Math.max(0, lm.shoulderY - lm.wristY);
    return {
      height: lm.H,
      armLength: Math.sqrt(dxArm * dxArm + dyArm * dyArm),
      legLength: lm.groinY - lm.groundY,
      shoulderWidth: 2 * lm.shoulderWidth,
      hipWidth: 2 * lm.hipX,
      armReach: lm.handX
    };
  };

  ArpSmart.setMeasurement = function (key, valueMeters) {
    if (!ArpSmart.landmarks) return null;
    var v = +valueMeters;
    if (!isFinite(v) || v <= 0) return null;
    if (!ArpSmart.overrides) ArpSmart.overrides = {};
    var lm = ArpSmart.landmarks;
    if (key === 'shoulderWidth') ArpSmart.overrides.shoulderWidth = v / 2;
    else if (key === 'hipWidth') ArpSmart.overrides.hipX = v / 2;
    else if (key === 'armReach') ArpSmart.overrides.handX = v;
    else if (key === 'legLength') ArpSmart.overrides.groinY = lm.groundY + v;
    else return null;
    ArpSmart.repositionMarkersFromLandmarks();
    ArpSmart.updateGhost();
    ArpSmart.saveSession();
    ArpSmart.refreshReadout();
    return ArpSmart.computeMeasurements();
  };

  /* Đặt lại vị trí mọi marker theo landmark hiệu dụng (sau khi đổi
     số đo bằng slider). Hướng trái/phải lấy theo id (Left âm). */
  ArpSmart.repositionMarkersFromLandmarks = function () {
    var lm = effectiveLandmarks();
    if (!lm) return false;
    ArpSmart.markers.forEach(function (m) {
      var p = markerPositionFromLandmarks(m, lm);
      if (m.mesh) m.mesh.position.set(p.x, p.y, p.z);
      m.position = p;
    });
    return true;
  };

  /* ---------- Drag / đặt bằng chuột-chạm trên viewport ----------
     Place mode BẬT: bấm lên mesh → đặt marker đang chọn tại điểm đó.
     Kéo marker: raycast + pointermove trên mặt phẳng hướng camera.
     Bấm đúp marker: xóa marker đó.
     Chặn orbit: khi Place mode bật thì OrbitCam.enabled=false suốt
     thời gian bật; khi kéo marker thì tắt từ pointerdown tới
     pointerup (xem ghi chú đầu file). */
  ArpSmart.setPlaceMode = function (on) {
    if (on && !ArpSmart.landmarks) {
      notify('warning', 'Tab Smart', 'Bấm “Guess Markers” trước để đo landmark, rồi mới bật Place markers.');
      return false;
    }
    ArpSmart.placeMode = !!on;
    ArpSmart._setOrbitEnabled(!ArpSmart.placeMode);
    ArpSmart.saveSession();
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    if (ArpSmart.placeMode) {
      notify('info', 'Tab Smart', 'Place markers BẬT — bấm lên model để đặt marker “' + ArpSmart.selectedMarkerId + '” (mirror ' + (ArpSmart.mirrorEnabled ? 'BẬT' : 'TẮT') + '). Camera đã khóa xoay trong lúc đặt.', 9000);
    }
    return ArpSmart.placeMode;
  };

  ArpSmart._bindDrag = function () {
    var canvas = getCanvas();
    var camera = getCamera();
    if (!canvas || !camera || !window.THREE) return;
    if (ArpSmart._dragBound === canvas) return;
    ArpSmart._dragBound = canvas;
    var raycaster = new THREE.Raycaster();
    var pointer = new THREE.Vector2();
    var dragPlane = new THREE.Plane();
    var hitPoint = new THREE.Vector3();

    function setPointerFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var cx = (e.clientX != null ? e.clientX : rect.left) - rect.left;
      var cy = (e.clientY != null ? e.clientY : rect.top) - rect.top;
      pointer.x = (cx / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -(cy / Math.max(1, rect.height)) * 2 + 1;
    }
    function pickMarker() {
      raycaster.setFromCamera(pointer, camera);
      var meshes = ArpSmart.markers.map(function (m) { return m.mesh; }).filter(Boolean);
      var hits = raycaster.intersectObjects(meshes, false);
      return hits.length ? hits[0] : null;
    }
    function pickMeshPoint() {
      raycaster.setFromCamera(pointer, camera);
      var meshes = collectMeshes(getTarget(ArpSmart.target));
      if (!meshes.length) return null;
      var hits = raycaster.intersectObjects(meshes, false);
      return hits.length ? hits[0] : null;
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (ArpSmart.placeMode) {
        setPointerFromEvent(e);
        var hit = pickMeshPoint();
        if (hit) {
          ArpSmart.placeMarker(ArpSmart.selectedMarkerId,
            { x: hit.point.x, y: hit.point.y, z: hit.point.z }, { snap: true });
          /* Khóa orbit trong lúc đặt (đã khóa suốt Place mode, giữ
             thêm cờ để pointerup không mở lại nhầm). */
          ArpSmart._orbitOff = true;
          ArpSmart._setOrbitEnabled(false);
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
        }
        return;
      }
      if (!ArpSmart.markers.length) return;
      setPointerFromEvent(e);
      var mh = pickMarker();
      if (!mh) return;
      var hit2 = mh;
      var camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      dragPlane.setFromNormalAndCoplanarPoint(camDir.clone().negate(), hit2.point);
      ArpSmart.dragging = { markerId: hit2.object.userData.markerId };
      ArpSmart._orbitOff = true;
      ArpSmart._setOrbitEnabled(false);
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    });

    canvas.addEventListener('dblclick', function (e) {
      if (!ArpSmart.markers.length) return;
      setPointerFromEvent(e);
      var mh = pickMarker();
      if (!mh) return;
      ArpSmart.removeMarker(mh.object.userData.markerId);
      if (e.preventDefault) e.preventDefault();
    });

    window.addEventListener('pointermove', function (e) {
      if (!ArpSmart.dragging) return;
      setPointerFromEvent(e);
      raycaster.setFromCamera(pointer, camera);
      var p = raycaster.ray.intersectPlane(dragPlane, hitPoint);
      if (!p) return;
      ArpSmart.applyMarkerDrag(ArpSmart.dragging.markerId, { x: p.x, y: p.y, z: p.z });
    });

    window.addEventListener('pointerup', function () {
      var wasDragging = !!ArpSmart.dragging;
      ArpSmart.dragging = null;
      if (ArpSmart._orbitOff) {
        ArpSmart._orbitOff = false;
        if (!ArpSmart.placeMode) ArpSmart._setOrbitEnabled(true);
      }
      if (wasDragging) ArpSmart.saveSession();
    });
  };

  /* ---------- Ghost skeleton (preview trước khi rig) ----------
     Đường nối + khớp tròn màu cyan, material transparent — CHỈ LÀ
     HIỂN THỊ, không phải rig thật cho tới khi bấm Rig now.
     Vị trí khớp = boneWorldPositions(landmark hiệu dụng, opts rig
     hiện tại) nên khớp ghost trùng vị trí marker (vai/cổ tay/mắt cá
     dùng chung công thức). Kéo marker → updateGhost() tính lại ngay. */
  function rigOptsToVariantOpts() {
    var r = ArpSmart.rigOpts;
    /* NHÓM 6 — Animal presets: preset động vật thì boneSet 'animal:<id>'
       (AutoRigPro chưa biết boneSet này → ArpSmart.rig() chặn lại, xem
       dưới; ghost/marker vẫn dùng boneDefs của preset). */
    if (r.preset && r.preset !== 'humanoid') {
      return {
        boneSet: 'animal:' + r.preset, animalPreset: r.preset,
        fingers: r.fingers !== false, toes: r.toes !== false, twist: !!r.twist,
        spineSegments: r.spineSegments || 3, neckSegments: r.neckSegments || 1, pose: r.pose || 'T'
      };
    }
    return {
      boneSet: r.boneCount === 28 ? 'hy3d28' : (r.boneCount === 15 ? 'minimal15' : 'full41'),
      fingers: r.fingers !== false, toes: r.toes !== false, twist: !!r.twist,
      spineSegments: r.spineSegments || 3, neckSegments: r.neckSegments || 1, pose: r.pose || 'T'
    };
  }
  ArpSmart.rigOptsToVariantOpts = rigOptsToVariantOpts;

  /* NHÓM 6 — Animal presets: preset đang chọn + boneDefs tương ứng
     (humanoid → null, để code cũ dùng variantBoneDefs như trước). */
  ArpSmart.getActivePresetId = function () {
    var id = ArpSmart.rigOpts && ArpSmart.rigOpts.preset;
    if (!id) return 'humanoid';
    var AP = (typeof window !== 'undefined' ? window : global).PixiStudio &&
      ((typeof window !== 'undefined' ? window : global).PixiStudio.ArpAnimalPresets);
    if (AP && AP.getPreset && !AP.getPreset(id)) return 'humanoid';
    return id;
  };
  ArpSmart.getActiveBoneDefs = function () {
    var id = ArpSmart.getActivePresetId();
    if (id === 'humanoid') return null;
    var AP = (typeof window !== 'undefined' ? window : global).PixiStudio &&
      ((typeof window !== 'undefined' ? window : global).PixiStudio.ArpAnimalPresets);
    return (AP && AP.boneDefs) ? AP.boneDefs(id) : null;
  };

  /* VÒNG GIỮ XƯƠNG GỐC (2026-11-27 ~14:19): tách phần TÍNH vị trí
     ghost khỏi phần DỰNG group — dữ liệu ghost (vị trí/độ dài/
     hierarchy) là lớp hiển thị RIÊNG của Smart (template từ
     landmark), KHÔNG còn là chuẩn canonical (chuẩn = xương thật,
     xem ArpSharedSkeleton). Group ghost scene-level (__arp_ghost__)
     được dựng lại ở buildGhost, mặc định ẨN khi model có xương thật. */
  ArpSmart._ghostPositions = function () {
    if (!ArpSmart.landmarks) return null;
    var ARP = PixiStudio.AutoRigPro;
    if (!ARP || !ARP._test || !ARP._test.boneWorldPositions) return null;
    var eff = effectiveLandmarks();
    var vOpts = rigOptsToVariantOpts();
    var pos = ARP._test.boneWorldPositions(eff, {
      symmetrical: ArpSmart.settings.symmetrical !== false,
      useDepth: !!ArpSmart.settings.useDepth,
      twist: vOpts.twist, neckSegments: vOpts.neckSegments, pose: vOpts.pose
    });
    /* NHÓM 6 — Animal presets: suy vị trí khớp preset từ vị trí humanoid. */
    if (ArpSmart.getActivePresetId() !== 'humanoid') {
      var APg = window.PixiStudio && PixiStudio.ArpAnimalPresets;
      if (APg && APg.resolvePositions) pos = APg.resolvePositions(pos, ArpSmart.getActivePresetId());
    }
    /* VÒNG SỬA GHOST LỆCH (2026-11-27 ~14:23): template đặt tay trái
       ở −X, nhưng file Mixamo/Tripo (nhân vật hướng +Z) đặt tay trái
       ở +X — ghost không mirror sẽ đứng ngược tay (LeftHand ghost
       lên tay phải nhân vật). Khi model ĐÃ CÓ rig, dò hướng mặt từ
       xương thật (LeftHand/LeftArm world X so với cx): nếu tay trái
       thật ở +X thì mirror toàn bộ vị trí ghost qua cx
       (x' = 2·cx − x) để khớp ghost trùng khớp thật cùng tên (mục
       tiêu ≤2cm). Model chưa rig: giữ nguyên template (không có
       thông tin hướng mặt để dò). Chỉ đổi dữ liệu hiển thị ghost —
       boneWorldPositions (dùng để rig) KHÔNG đổi. */
    try {
      var tgt = (typeof getTarget === 'function') ? getTarget() : null;
      if (tgt && tgt.traverse && eff && isFinite(eff.cx)) {
        var leftX = null;
        tgt.traverse(function (o) {
          if (leftX != null || !o || !o.isBone) return;
          var nm = String(o.name || '').replace(/^.*:/, '').replace(/^mixamorig/i, '');
          if (nm === 'LeftHand' || nm === 'LeftArm') {
            try {
              var vv = new THREE.Vector3();
              o.getWorldPosition(vv);
              leftX = vv.x;
            } catch (e) {}
          }
        });
        if (leftX != null && leftX > eff.cx) {
          Object.keys(pos).forEach(function (k) {
            var p = pos[k];
            if (p) p.x = 2 * eff.cx - p.x;
          });
        }
      }
    } catch (e) {}
    var defs = ArpSmart.getActiveBoneDefs() ||
      (ARP._test.variantBoneDefs ? ARP._test.variantBoneDefs(vOpts) : ARP.BONE_DEFS);
    var pairs = [];
    defs.forEach(function (d) { if (d.parent) pairs.push([d.parent, d.name]); });
    var jointPositions = {};
    Object.keys(pos).forEach(function (k) {
      jointPositions[k] = { x: pos[k].x, y: pos[k].y, z: pos[k].z };
    });
    return { pos: pos, jointPositions: jointPositions, pairs: pairs, defs: defs, H: eff.H };
  };

  /* Đo lại landmark cho model (đổi model / dời model — ghost không
     dùng số đo cũ của model trước). Dùng bởi ArpSharedSkeleton khi
     model:loaded / transform:changed. */
  ArpSmart.refreshLandmarks = function (target) {
    var ARP = window.PixiStudio && PixiStudio.AutoRigPro;
    if (!ARP || typeof ARP.measureLandmarks !== 'function') return null;
    target = getTarget(target || ArpSmart.target);
    if (!target) return null;
    try {
      var lm = ARP.measureLandmarks(target);
      if (lm) { ArpSmart.landmarks = lm; ArpSmart.target = target; }
      return lm || null;
    } catch (e) { return null; }
  };

  ArpSmart._updateGhostLines = function (pos) {
    var g = ArpSmart.ghost;
    if (!g.lines || !g.pairs.length || !pos) return;
    var attr = g.lines.geometry.attributes.position;
    for (var i = 0; i < g.pairs.length; i++) {
      var a = pos[g.pairs[i][0]], b = pos[g.pairs[i][1]];
      if (!a || !b) continue;
      attr.array[i * 6] = a.x; attr.array[i * 6 + 1] = a.y; attr.array[i * 6 + 2] = a.z;
      attr.array[i * 6 + 3] = b.x; attr.array[i * 6 + 4] = b.y; attr.array[i * 6 + 5] = b.z;
    }
    attr.needsUpdate = true;
  };

  /* Dọn group ghost cũ khỏi scene (chỉ buildGhost dùng, trước khi
     dựng group mới). hideGhost() KHÔNG gọi hàm này — hide chỉ ẩn,
     group vẫn tồn tại để bật lại (user: "ko bỏ ghost mà tắt đi
     thôi"). */
  function _disposeGhostGroup() {
    var g = ArpSmart.ghost.group;
    if (!g) return;
    try {
      var scene = getScene();
      if (scene) scene.remove(g);
    } catch (e) {}
    try {
      var mats = {};
      g.traverse(function (o) {
        if (o.isMesh || o.isLineSegments || o.isLine) {
          if (o.geometry && o.geometry.dispose) o.geometry.dispose();
        }
        if (o.material && !mats[o.material.uuid]) { mats[o.material.uuid] = o.material; if (o.material.dispose) o.material.dispose(); }
      });
    } catch (e) {}
    ArpSmart.ghost.group = null;
    ArpSmart.ghost.joints = {};
    ArpSmart.ghost.lines = null;
  }

  ArpSmart.buildGhost = function () {
    var gp = ArpSmart._ghostPositions();
    if (!gp) return false;
    var pos = gp.pos, defs = gp.defs, pairs = gp.pairs;
    ArpSmart.ghost.jointPositions = gp.jointPositions;
    ArpSmart.ghost.pairs = pairs;
    if (!window.THREE) return true;
    /* VÒNG GIỮ XƯƠNG GỐC (2026-11-27 ~14:19): ghost là lớp hiển thị
       RIÊNG — dựng group __arp_ghost__ scene-level từ vị trí
       template (landmark), KHÔNG alias tới canonical group nữa
       (canonical = xương thật, do VP skeleton hiển thị). Group
       ghost mặc định ẨN khi model có xương thật vì cờ visible mặc
       định false; user bật lại bằng nút Ghost / showGhost().
       Lưu ý: group scene-level nướng cứng vị trí world lúc build —
       model dời đi thì ghost không theo; đó là giới hạn đã biết của
       lớp ghost riêng (chỉ dùng để đối chiếu template), xương thật
       vẫn là chuẩn hiển thị chính và luôn theo model. */
    var scene = getScene();
    if (!scene) return true;
    /* Giữ lại cờ visible trước khi dọn group cũ. */
    var wasVisible = ArpSmart.ghost.visible;
    _disposeGhostGroup();
    ArpSmart.ghost.visible = wasVisible;
    var H = gp.H;
    var group = new THREE.Group();
    group.name = '__arp_ghost__';
    var jointMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.9, depthTest: false });
    var lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.65, depthTest: false });
    var joints = {};
    defs.forEach(function (d) {
      var p = pos[d.name];
      if (!p) return;
      var geo = new THREE.SphereGeometry(Math.max(0.006, H * 0.012), 10, 8);
      var m = new THREE.Mesh(geo, jointMat);
      m.position.copy(p);
      m.renderOrder = 998;
      m.userData.isArpGhost = true;
      m.userData.boneName = d.name;
      group.add(m);
      joints[d.name] = m;
    });
    var linePos = new Float32Array(pairs.length * 6);
    var lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    var lines = new THREE.LineSegments(lg, lineMat);
    lines.renderOrder = 998;
    lines.userData.isArpGhost = true;
    group.add(lines);
    ArpSmart.ghost.group = group;
    ArpSmart.ghost.joints = joints;
    ArpSmart.ghost.lines = lines;
    ArpSmart._updateGhostLines(pos);
    group.visible = wasVisible;
    scene.add(group);
    return true;
  };

  ArpSmart.updateGhost = function () {
    if (!ArpSmart.ghost.visible || !ArpSmart.ghost.group) return false;
    var gp = ArpSmart._ghostPositions();
    if (!gp) return false;
    ArpSmart.ghost.jointPositions = gp.jointPositions;
    ArpSmart.ghost.pairs = gp.pairs;
    /* VÒNG GIỮ XƯƠNG GỐC: updateCanonicalFromGhost giờ luôn từ chối
       (ghost không lái canonical nữa) — rơi xuống fallback dời khớp
       cầu ghost bên dưới. Chỉ dời khớp của group ghost RIÊNG
       (__arp_ghost__); không bao giờ dời khớp chuẩn / xương thật. */
    var SH = window.PixiStudio && PixiStudio.ArpSharedSkeleton;
    if (SH && typeof SH.updateCanonicalFromGhost === 'function') {
      try {
        var r = SH.updateCanonicalFromGhost(gp.jointPositions, gp.pairs);
        if (r && r.ok) return true;
      } catch (e) {}
    }
    /* Fallback (group ghost scene-level): dời khớp cầu + đường nối. */
    if (!ArpSmart.ghost.group || ArpSmart.ghost.group.name !== '__arp_ghost__') return true;
    Object.keys(gp.pos).forEach(function (k) {
      var j = ArpSmart.ghost.joints[k];
      if (j && j.isMesh) j.position.copy(gp.pos[k]);
    });
    ArpSmart._updateGhostLines(gp.pos);
    return true;
  };

  ArpSmart.regenerateGhost = function () {
    if (!ArpSmart.landmarks) { notify('warning', 'Tab Smart', 'Chưa có marker — bấm Guess Markers trước rồi mới xem ghost.'); return false; }
    ArpSmart.ghost.visible = true;
    var ok = ArpSmart.buildGhost();
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    return ok;
  };

  ArpSmart.showGhost = function () {
    if (!ArpSmart.landmarks) { notify('warning', 'Tab Smart', 'Chưa có marker — bấm Guess Markers trước rồi mới xem ghost.'); return false; }
    ArpSmart.ghost.visible = true;
    /* VÒNG GIỮ XƯƠNG GỐC: ghost là lớp hiển thị RIÊNG
       (__arp_ghost__) — hiện group ghost, KHÔNG bật VP skeleton
       (xương thật) và KHÔNG đổi chuẩn hiển thị: bật ghost lên cũng
       không làm lệch xương thật. */
    if (!ArpSmart.ghost.group || !ArpSmart.ghost.jointPositions || !Object.keys(ArpSmart.ghost.jointPositions).length) ArpSmart.buildGhost();
    else ArpSmart.ghost.group.visible = true;
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    return true;
  };

  ArpSmart.hideGhost = function () {
    ArpSmart.ghost.visible = false;
    /* VÒNG GIỮ XƯƠNG GỐC: chỉ ẨN group ghost — KHÔNG dispose, KHÔNG
       xóa group/code (user: "ko bỏ ghost mà tắt đi thôi"); group
       __arp_ghost__ vẫn tồn tại trong scene, bật lại bằng showGhost.
       KHÔNG chạm VP skeleton / xương thật / canonical. */
    if (ArpSmart.ghost.group) ArpSmart.ghost.group.visible = false;
    return true;
  };

  /* ---------- [NHÓM 1 — Decimation/Shape 2026-11-27] Phân tích
     hình dạng mesh + decimate trước khi rig (js/rig/arp-decimate.js).
     Render trực tiếp trong tab Smart (không qua QuickRig
     registerSection — phân tích + decimate là bước chuẩn bị của
     Smart, chạy trước Guess Markers/Rig). ---------- */
  ArpSmart.analyzeShape = function (target) {
    var AD = window.PixiStudio && PixiStudio.ArpDecimate;
    if (!AD || !AD.analyzeShape) { notify('error', 'Tab Smart', 'ArpDecimate chưa load (js/rig/arp-decimate.js).'); return null; }
    target = getTarget(target || ArpSmart.target);
    if (!target) { notify('warning', 'Tab Smart', 'Chưa có model nào — load model trước rồi bấm “Phân tích mesh”.'); return null; }
    var a = AD.analyzeShape(target);
    if (!a || !a.ok) { notify('error', 'Tab Smart', 'Phân tích mesh lỗi: ' + ((a && a.error) || '?')); return a; }
    ArpSmart.target = target;
    ArpSmart.lastShapeAnalysis = a;
    ArpSmart.lastRigPlan = a.rigPlan || null;
    ArpSmart.saveSession();
    ArpSmart.refreshReadout();
    notify('success', 'Phân tích mesh xong', AD.summarizeAnalysis(a), 15000);
    return a;
  };

  ArpSmart.setDecimateOpt = function (key, value) {
    var d = ArpSmart.decimateOpts;
    if (key === 'enabled') d.enabled = !!value;
    else if (key === 'protectJoints') d.protectJoints = !!value;
    else if (key === 'ratio') {
      var r = +value;
      if (!isFinite(r) || r <= 0 || r >= 1) return false;
      d.ratio = r;
    } else return false;
    ArpSmart.saveSession();
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    return true;
  };

  /* Decimate ngay (không chờ Rig): chờ meshopt WASM rồi chạy đồng
     bộ. Trả Promise<result>. */
  ArpSmart.decimateNow = function (target) {
    var AD = window.PixiStudio && PixiStudio.ArpDecimate;
    if (!AD || !AD.decimateAsync) { notify('error', 'Tab Smart', 'ArpDecimate chưa load (js/rig/arp-decimate.js).'); return Promise.resolve(null); }
    target = getTarget(target || ArpSmart.target);
    if (!target) { notify('warning', 'Tab Smart', 'Chưa có model nào để decimate.'); return Promise.resolve(null); }
    return AD.decimateAsync(target, {
      ratio: ArpSmart.decimateOpts.ratio,
      protectJoints: ArpSmart.decimateOpts.protectJoints,
      landmarks: ArpSmart.landmarks || undefined
    }).then(function (r) {
      if (r && r.ok) {
        ArpSmart.lastDecimate = r;
        if (r.trisAfter < r.trisBefore) ArpSmart.lastDecimateTarget = target;
        ArpSmart.saveSession();
        ArpSmart.refreshReadout();
        notify('success', 'Decimate xong', AD.summarizeDecimate(r), 12000);
      } else if (r) notify('error', 'Decimate lỗi', r.error || '?');
      return r;
    });
  };

  /* ---------- Tùy chọn rig khi generate ---------- */
  ArpSmart.setRigOpt = function (key, value) {
    var r = ArpSmart.rigOpts;
    if (key === 'boneCount') {
      var n = +value;
      if (n !== 41 && n !== 28 && n !== 15) return false;
      r.boneCount = n;
    } else if (key === 'fingers' || key === 'toes' || key === 'twist') {
      r[key] = !!value;
    } else if (key === 'spineSegments') {
      var s = +value;
      if (s !== 1 && s !== 2 && s !== 3) return false;
      r.spineSegments = s;
    } else if (key === 'neckSegments') {
      var nk = +value;
      if (nk !== 1 && nk !== 2) return false;
      r.neckSegments = nk;
    } else if (key === 'pose') {
      if (value !== 'T' && value !== 'A') return false;
      r.pose = value;
    } else if (key === 'preset') {
      /* NHÓM 6 — Animal presets: chỉ nhận id preset hợp lệ; humanoid
         giữ nguyên mọi hành vi cũ. */
      var ids = ['humanoid', 'quadruped', 'robot', 'bird'];
      var APs = (typeof window !== 'undefined' ? window : global).PixiStudio &&
        ((typeof window !== 'undefined' ? window : global).PixiStudio.ArpAnimalPresets);
      if (APs && APs.listIds) ids = APs.listIds();
      if (ids.indexOf(value) < 0) return false;
      r.preset = value;
    } else return false;
    ArpSmart.saveSession();
    if (ArpSmart.ghost.visible) ArpSmart.buildGhost();
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
    return true;
  };

  /* ---------- Session (localStorage) ---------- */
  ArpSmart.saveSession = function () {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      var data = {
        v: 2,
        savedAt: new Date().toISOString(),
        landmarks: ArpSmart.landmarks,
        overrides: ArpSmart.overrides,
        settings: ArpSmart.settings,
        markerLevel: ArpSmart.markerLevel,
        selectedMarkerId: ArpSmart.selectedMarkerId,
        mirrorEnabled: ArpSmart.mirrorEnabled,
        manualMode: ArpSmart.manualMode,
        humanoidCheck: ArpSmart.humanoidCheck,
        rigOpts: ArpSmart.rigOpts,
        /* [NHÓM 1] Lưu tùy chọn decimate (không lưu kết quả phân tích
           — phân tích lại bằng nút "Phân tích mesh" sau khi load). */
        decimateOpts: ArpSmart.decimateOpts,
        markers: ArpSmart.markers.map(function (m) {
          var p = m.mesh ? { x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z } : (m.position || { x: 0, y: 0, z: 0 });
          return { id: m.id, position: p };
        })
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  };

  ArpSmart.restoreSession = function (target) {
    var raw = null;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return { restored: false, reason: 'no-localStorage' };
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (e) { return { restored: false, reason: 'localStorage-lỗi' }; }
    if (!raw) return { restored: false, reason: 'empty' };
    var data;
    try { data = JSON.parse(raw); } catch (e) { return { restored: false, reason: 'json-lỗi' }; }
    if (!data || !data.landmarks) return { restored: false, reason: 'empty' };
    if (data.settings) {
      ArpSmart.settings.symmetrical = data.settings.symmetrical !== false;
      ArpSmart.settings.addNeck = !!data.settings.addNeck;
      ArpSmart.settings.useDepth = !!data.settings.useDepth;
    }
    if (data.rigOpts) {
      Object.keys(data.rigOpts).forEach(function (k) { ArpSmart.rigOpts[k] = data.rigOpts[k]; });
    }
    /* [NHÓM 1] Khôi phục tùy chọn decimate. */
    if (data.decimateOpts) {
      if (data.decimateOpts.enabled !== undefined) ArpSmart.decimateOpts.enabled = !!data.decimateOpts.enabled;
      if (data.decimateOpts.ratio) ArpSmart.decimateOpts.ratio = data.decimateOpts.ratio;
      if (data.decimateOpts.protectJoints !== undefined) ArpSmart.decimateOpts.protectJoints = !!data.decimateOpts.protectJoints;
    }
    if (data.markerLevel !== undefined) ArpSmart.markerLevel = data.markerLevel;
    if (data.mirrorEnabled !== undefined) ArpSmart.mirrorEnabled = !!data.mirrorEnabled;
    if (data.manualMode !== undefined) ArpSmart.manualMode = !!data.manualMode;
    if (data.humanoidCheck) ArpSmart.humanoidCheck = data.humanoidCheck;
    if (data.selectedMarkerId) ArpSmart.selectedMarkerId = data.selectedMarkerId;
    ArpSmart.landmarks = data.landmarks;
    ArpSmart.overrides = data.overrides || null;
    ArpSmart.target = getTarget(target);
    var lm = effectiveLandmarks();
    var defs = null;
    if (data.markers && data.markers.length) {
      defs = [];
      data.markers.forEach(function (sm) {
        var d = lookupMarkerDef(sm.id, lm);
        if (!d) return;
        defs.push({ id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: d.yOffset, zOffset: d.zOffset, mirror: d.mirror, color: d.color, position: sm.position || d.position });
      });
    }
    if (!defs || !defs.length) defs = positionsFromLandmarks(lm);
    showMarkers(defs, ArpSmart.target);
    ArpSmart.refreshReadout();
    ArpSmart._syncControls();
    notify('success', 'Restore Last Session',
      'Đã khôi phục ' + defs.length + ' marker' + (ArpSmart.overrides ? ' + chỉnh sửa đã kéo' : '') +
      (ArpSmart.markerLevel ? ' · mức ' + ArpSmart.markerLevel : '') +
      ' (lưu ' + (data.savedAt || '?') + '). Bấm Rig để rig với landmark này.', 10000);
    return { restored: true, savedAt: data.savedAt || null };
  };

  ArpSmart.cancelAndDeleteMarkers = function () {
    ArpSmart.clearMarkers();
    ArpSmart.hideGhost();
    ArpSmart.overrides = null;
    ArpSmart.manualMode = false;
    ArpSmart.saveSession();
    ArpSmart.refreshReadout();
    ArpSmart._syncControls();
    notify('info', 'Tab Smart', 'Đã xóa hết marker, reset landmark về giá trị đã đo.');
  };

  /* ---------- Marker set: nhiều set đặt tên + xuất/nhập JSON ---------- */
  function loadSets() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return {};
      var raw = window.localStorage.getItem(SETS_KEY);
      if (!raw) return {};
      var data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (e) { return {}; }
  }
  function saveSets(obj) {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return false;
      window.localStorage.setItem(SETS_KEY, JSON.stringify(obj));
      return true;
    } catch (e) { return false; }
  }
  function markerSetData(name) {
    return {
      format: 'pixistudio-arp-markers-1',
      name: name || '',
      savedAt: new Date().toISOString(),
      markerLevel: ArpSmart.markerLevel,
      rigOpts: ArpSmart.rigOpts,
      landmarks: ArpSmart.landmarks,
      overrides: ArpSmart.overrides,
      markers: ArpSmart.markers.map(function (m) {
        var p = m.mesh ? { x: m.mesh.position.x, y: m.mesh.position.y, z: m.mesh.position.z } : (m.position || { x: 0, y: 0, z: 0 });
        return { id: m.id, position: p };
      })
    };
  }
  function applyMarkerSetData(data) {
    if (!data || !Array.isArray(data.markers) || !data.markers.length) return { ok: false, error: 'marker set không có marker nào' };
    if (data.landmarks) ArpSmart.landmarks = data.landmarks;
    if (!ArpSmart.landmarks) return { ok: false, error: 'marker set không có landmark — bấm Guess Markers trước' };
    if (data.overrides !== undefined) ArpSmart.overrides = data.overrides;
    if (data.markerLevel !== undefined) ArpSmart.markerLevel = data.markerLevel;
    if (data.rigOpts) Object.keys(data.rigOpts).forEach(function (k) { ArpSmart.rigOpts[k] = data.rigOpts[k]; });
    var lm = effectiveLandmarks();
    var defs = [];
    data.markers.forEach(function (sm) {
      if (!sm || !sm.id) return;
      var d = lookupMarkerDef(sm.id, lm);
      if (!d) return;
      defs.push({ id: d.id, label: d.label, landmarkKey: d.landmarkKey, xKey: d.xKey, yOffset: d.yOffset, zOffset: d.zOffset, mirror: d.mirror, color: d.color, position: sm.position || d.position });
    });
    if (!defs.length) return { ok: false, error: 'không có marker nào hợp lệ trong set' };
    ArpSmart.target = ArpSmart.target || getTarget(null);
    showMarkers(defs, ArpSmart.target);
    ArpSmart.saveSession();
    ArpSmart.refreshReadout();
    ArpSmart._syncControls();
    return { ok: true, count: defs.length };
  }

  ArpSmart.saveMarkerSet = function (name) {
    name = String(name || '').trim();
    if (!name) return false;
    if (!ArpSmart.markers.length) { notify('warning', 'Tab Smart', 'Chưa có marker nào để lưu thành set.'); return false; }
    var sets = loadSets();
    sets[name] = markerSetData(name);
    if (!saveSets(sets)) return false;
    ArpSmart._syncControls();
    return true;
  };

  ArpSmart.listMarkerSets = function () {
    var sets = loadSets();
    return Object.keys(sets).sort().map(function (name) {
      var s = sets[name] || {};
      return { name: name, savedAt: s.savedAt || null, markerCount: (s.markers || []).length, level: s.markerLevel || null };
    });
  };

  ArpSmart.loadMarkerSet = function (name) {
    var sets = loadSets();
    var data = sets[String(name || '')];
    if (!data) return { ok: false, error: 'không tìm thấy set "' + name + '"' };
    var r = applyMarkerSetData(data);
    if (r.ok) notify('success', 'Tab Smart', 'Đã tải marker set "' + name + '" (' + r.count + ' marker).');
    return r;
  };

  ArpSmart.deleteMarkerSet = function (name) {
    var sets = loadSets();
    if (!sets[String(name || '')]) return false;
    delete sets[String(name || '')];
    var ok = saveSets(sets);
    ArpSmart._syncControls();
    return ok;
  };

  ArpSmart.exportMarkerSetJSON = function (name) {
    var data;
    if (name) {
      var sets = loadSets();
      data = sets[String(name)];
      if (!data) return null;
    } else {
      data = markerSetData('');
    }
    try { return JSON.stringify(data, null, 2); } catch (e) { return null; }
  };

  ArpSmart.importMarkerSetJSON = function (text) {
    var data;
    try { data = JSON.parse(String(text || '')); } catch (e) { return { ok: false, error: 'JSON lỗi: ' + (e && e.message || e) }; }
    if (!data || typeof data !== 'object') return { ok: false, error: 'JSON không phải object' };
    if (data.format && data.format !== 'pixistudio-arp-markers-1') return { ok: false, error: 'format lạ: ' + data.format };
    var r = applyMarkerSetData(data);
    if (r.ok) notify('success', 'Tab Smart', 'Đã nhập marker set (' + r.count + ' marker).');
    return r;
  };

  /* ---------- Rig ---------- */
  ArpSmart.buildRunOpts = function (extra) {
    var vOpts = rigOptsToVariantOpts();
    var opts = {
      symmetrical: ArpSmart.settings.symmetrical !== false,
      addNeck: !!ArpSmart.settings.addNeck,
      useDepth: !!ArpSmart.settings.useDepth,
      landmarkOverrides: ArpSmart.overrides ? Object.assign({}, ArpSmart.overrides) : null,
      export: true,
      boneSet: vOpts.boneSet,
      fingers: vOpts.fingers,
      toes: vOpts.toes,
      twist: vOpts.twist,
      spineSegments: vOpts.spineSegments,
      neckSegments: vOpts.neckSegments,
      pose: vOpts.pose,
      /* NHÓM 6 — Animal presets: chuyển tiếp cho auto-rig-pro.js tương lai
         (hiện AutoRigPro chưa đọc animalPreset — ArpSmart.rig() chặn
         preset động vật, xem dưới). */
      animalPreset: vOpts.animalPreset || null,
      animalBoneDefs: ArpSmart.getActiveBoneDefs()
    };
    /* [NHÓM 1 — Decimation/Shape 2026-11-27] Áp rig plan từ phân tích
       hình dạng (robot → 28 xương gọn, bỏ ngón tay/chân) + gắn
       metadata phân tích/decimate để AutoRigPro.run() lưu vào
       result/rig. Chỉ ghi đè khi plan tương thích pipeline humanoid
       (autoRigCompatible); plan quadruped/creature đã bị chặn ở
       ArpSmart.rig() nên không tới được đây. */
    if (ArpSmart.lastRigPlan && ArpSmart.lastRigPlan.autoRigCompatible) {
      if (ArpSmart.lastRigPlan.boneSet === 'hy3d28') {
        opts.boneSet = 'hy3d28'; opts.fingers = false; opts.toes = false;
      }
    }
    if (ArpSmart.lastShapeAnalysis) opts.shapeAnalysis = ArpSmart.lastShapeAnalysis;
    if (ArpSmart.lastRigPlan) opts.rigPlan = ArpSmart.lastRigPlan;
    if (ArpSmart.lastDecimate) opts.decimateResult = ArpSmart.lastDecimate;
    if (extra) Object.keys(extra).forEach(function (k) { opts[k] = extra[k]; });
    return opts;
  };

  ArpSmart.rig = function (extra) {
    var ARP = PixiStudio.AutoRigPro;
    if (!ARP || !ARP.run) { notify('error', 'Tab Smart', 'AutoRigPro chưa sẵn sàng.'); return null; }
    /* NHÓM 6 — Animal presets: AutoRigPro.run() hiện chỉ dựng được
       skeleton humanoid (variantBoneDefs/buildSkeleton). Rig tự động
       với preset động vật CHƯA hỗ trợ — chặn lại kèm hướng dẫn thay vì
       rig lén 41 xương humanoid lên thú/robot. Dùng Quick Rig để map
       xương có sẵn của model theo preset. */
    if (ArpSmart.getActivePresetId() !== 'humanoid') {
      notify('warning', 'Tab Smart',
        'Preset "' + ArpSmart.getActivePresetId() + '" chưa rig tự động được qua Smart ' +
        '(AutoRigPro mới dựng skeleton humanoid). Mở tab Quick Rig để map xương có sẵn ' +
        'của model theo preset này.');
      return null;
    }
    var target = getTarget(ArpSmart.target);
    if (!target) { notify('warning', 'Tab Smart', 'Chưa có model nào để rig. Load model trước.'); return null; }
    /* [NHÓM 1 — Decimation/Shape 2026-11-27] Chặn rig humanoid khi
       phân tích hình dạng đã chọn rig không tương thích
       (quadruped/creature) — không ép 41 xương lên thú; báo plan +
       cách làm thay thế, lưu vào metadata để các tab khác đọc. */
    if (ArpSmart.lastShapeAnalysis && ArpSmart.lastRigPlan && !ArpSmart.lastRigPlan.autoRigCompatible) {
      notify('warning', 'Tab Smart',
        'Không rig humanoid cho model này: ' + ArpSmart.lastRigPlan.reason + ' ' + (ArpSmart.lastRigPlan.buildVia || ''), 15000);
      ArpSmart.refreshReadout();
      return { ok: false, blocked: 'non-humanoid', shapeAnalysis: ArpSmart.lastShapeAnalysis, rigPlan: ArpSmart.lastRigPlan, errors: ['Rig humanoid không phù hợp: ' + ArpSmart.lastRigPlan.reason] };
    }
    /* [NHÓM 1] Decimate trước khi rig khi user bật tùy chọn — chỉ 1
       lần cho mỗi target (tránh decimate chồng lên mesh đã gọn).
       Meshopt WASM chưa sẵn sàng thì dừng và bảo user bấm
       "Decimate ngay" trước, không rig lén trên mesh chưa decimate. */
    if (ArpSmart.decimateOpts.enabled && ArpSmart.lastDecimateTarget !== target) {
      var AD1 = window.PixiStudio && PixiStudio.ArpDecimate;
      var MSE1 = window.PixiStudio && PixiStudio.MixamoSafeExport;
      var ready = AD1 && AD1.meshoptAvailable() && (!MSE1 || !MSE1.meshoptReady || MSE1.meshoptReady());
      if (!AD1 || !ready) {
        notify('warning', 'Tab Smart', 'Decimate trước khi rig đang BẬT nhưng meshopt chưa sẵn sàng — bấm “Decimate ngay” để chờ WASM rồi bấm Rig lại.');
        return { ok: false, blocked: 'decimate-not-ready', errors: ['Meshopt chưa sẵn sàng'] };
      }
      var dr = AD1.decimate(target, { ratio: ArpSmart.decimateOpts.ratio, protectJoints: ArpSmart.decimateOpts.protectJoints, landmarks: ArpSmart.landmarks || undefined });
      if (dr && dr.ok) {
        ArpSmart.lastDecimate = dr;
        if (dr.trisAfter < dr.trisBefore) ArpSmart.lastDecimateTarget = target;
        else notify('warning', 'Tab Smart', 'Decimate chạy nhưng không giảm được tris (meshopt trả nguyên) — vẫn rig trên mesh gốc.');
      }
    }
    var result = ARP.run(target, ArpSmart.buildRunOpts(extra));
    if (result && result.ok) {
      /* VÒNG GIỮ XƯƠNG GỐC (2026-11-27 ~14:19): KHÔNG hideGhost()
         nữa — display xương thật (VP layer dựng mesh trên khớp
         chuẩn = xương thật) không còn gắn với ghost; ẩn ghost lúc
         rig xong là sai — pose sync tự nhận xương thật mới theo
         tên. Ghost riêng vẫn tắt mặc định khi có xương thật. */
      ArpSmart.saveSession();
      /* --- AUTO KHỚP (js/rig/arp-automatch.js): rig Smart có thể thiếu
         xương ngón (boneSet hy3d28 chỉ có Thumb1/Index1/Middle1, không
         có đốt 2 / Ring / Pinky; minimal15 không có ngón nào) — tính
         bảng tự khớp để Quick Rig / Remap dùng chung, KHÔNG dừng rig
         khi thiếu ngón. Guard try/catch: automatch lỗi thì rig vẫn ok,
         chỉ thiếu báo cáo. --- */
      try {
        var AM = window.PixiStudio && PixiStudio.ArpAutoMatch;
        if (AM && typeof AM.autoMatch === 'function') {
          var rigBones = (result.rig && (result.rig.boneList || result.rig.bones)) || target;
          var amRes = AM.autoMatch(rigBones);
          ArpSmart.lastAutoMatch = amRes;
          result.autoMatch = {
            mappedCount: amRes.mappedCount, total: amRes.total,
            autoMatchedCount: amRes.autoMatchedCount,
            missing: amRes.missing.slice(), unresolved: amRes.unresolved.slice(),
            summary: AM.summarize(amRes)
          };
        }
      } catch (e) { ArpSmart.lastAutoMatchError = e && e.message; }
    }
    ArpSmart.refreshReadout();
    return result;
  };

  /* ---------- Render tab Smart ---------- */
  ArpSmart._syncControls = function () {
    if (typeof document === 'undefined') return;
    var g = function (id) { return document.getElementById(id); };
    var sym = g('arp-smart-sym');
    if (sym) sym.checked = ArpSmart.settings.symmetrical !== false;
    var dep = g('arp-smart-depth');
    if (dep) dep.checked = !!ArpSmart.settings.useDepth;
    var neck = g('arp-smart-addneck');
    if (neck) neck.textContent = 'Add Neck: ' + (ArpSmart.settings.addNeck ? 'BẬT' : 'TẮT');
    var lvl = g('arp-smart-level');
    if (lvl) lvl.value = ArpSmart.markerLevel || '';
    var place = g('arp-smart-place');
    if (place) {
      place.textContent = ArpSmart.placeMode ? '📍 Place markers: BẬT — bấm lên model để đặt' : '📍 Place markers';
      place.classList.toggle('arp-btn-primary', ArpSmart.placeMode);
    }
    var mir = g('arp-smart-mirror');
    if (mir) mir.checked = !!ArpSmart.mirrorEnabled;
    var ghostBtn = g('arp-smart-ghost');
    if (ghostBtn) ghostBtn.textContent = ArpSmart.ghost.visible ? '👻 Ghost skeleton: BẬT' : '👻 Ghost skeleton';
    var guessBtn = g('arp-smart-guess');
    if (guessBtn) guessBtn.disabled = !!ArpSmart.manualMode;
    var man = g('arp-smart-manual');
    if (man) man.style.display = ArpSmart.manualMode ? '' : 'none';
    var bc = g('arp-smart-bonecount');
    if (bc) bc.value = String(ArpSmart.rigOpts.boneCount);
    /* NHÓM 6 — Animal presets: đồng bộ dropdown preset. */
    var pr = g('arp-smart-preset');
    if (pr) pr.value = ArpSmart.getActivePresetId();
    var fi = g('arp-smart-fingers');
    if (fi) fi.checked = ArpSmart.rigOpts.fingers !== false;
    var to = g('arp-smart-toes');
    if (to) to.checked = ArpSmart.rigOpts.toes !== false;
    var tw = g('arp-smart-twist');
    if (tw) tw.checked = !!ArpSmart.rigOpts.twist;
    var sp = g('arp-smart-spine');
    if (sp) sp.value = String(ArpSmart.rigOpts.spineSegments);
    var nk = g('arp-smart-neckseg');
    if (nk) nk.value = String(ArpSmart.rigOpts.neckSegments);
    var po = g('arp-smart-pose');
    if (po) po.value = ArpSmart.rigOpts.pose || 'T';
    /* [NHÓM 1] Đồng bộ control decimate + phân tích. */
    var dcOn = g('arp-smart-decimate-on');
    if (dcOn) dcOn.checked = !!ArpSmart.decimateOpts.enabled;
    var dcRatio = g('arp-smart-decimate-ratio');
    if (dcRatio) dcRatio.value = String(ArpSmart.decimateOpts.ratio);
    var dcJ = g('arp-smart-decimate-joints');
    if (dcJ) dcJ.checked = ArpSmart.decimateOpts.protectJoints !== false;
    /* sliders + danh sách set đã lưu */
    var meas = ArpSmart.computeMeasurements();
    var setSlider = function (id, key) {
      var el = g(id);
      if (!el || !meas) return;
      el.value = meas[key];
      var lab = g(id + '-val');
      if (lab) lab.textContent = meas[key].toFixed(2) + 'm';
    };
    setSlider('arp-smart-slider-shoulderWidth', 'shoulderWidth');
    setSlider('arp-smart-slider-hipWidth', 'hipWidth');
    setSlider('arp-smart-slider-armReach', 'armReach');
    setSlider('arp-smart-slider-legLength', 'legLength');
    var setList = g('arp-smart-setlist');
    if (setList) {
      var cur = setList.value;
      var sets = ArpSmart.listMarkerSets();
      setList.innerHTML = sets.length
        ? sets.map(function (s) { return '<option value="' + s.name.replace(/"/g, '&quot;') + '">' + s.name + ' (' + s.markerCount + ' marker)</option>'; }).join('')
        : '<option value="">— chưa có set nào —</option>';
      if (cur) setList.value = cur;
    }
  };

  ArpSmart.refreshReadout = function () {
    if (typeof document === 'undefined') return;
    var status = document.getElementById('arp-smart-status');
    var lmList = document.getElementById('arp-smart-markers');
    var measure = document.getElementById('arp-smart-measure');
    var picklist = document.getElementById('arp-smart-picklist');
    var symRes = document.getElementById('arp-smart-symmetry-result');
    /* [NHÓM 1] Hiện kết quả phân tích hình dạng + decimate. */
    var AD = window.PixiStudio && PixiStudio.ArpDecimate;
    var shapeEl = document.getElementById('arp-smart-shape-result');
    if (shapeEl && AD) {
      shapeEl.textContent = ArpSmart.lastShapeAnalysis
        ? AD.summarizeAnalysis(ArpSmart.lastShapeAnalysis)
        : 'Chưa phân tích — bấm “Phân tích mesh”.';
    }
    var decEl = document.getElementById('arp-smart-decimate-result');
    if (decEl && AD) {
      decEl.textContent = ArpSmart.lastDecimate
        ? AD.summarizeDecimate(ArpSmart.lastDecimate)
        : 'Chưa decimate.';
    }
    if (measure) {
      var meas = ArpSmart.computeMeasurements();
      measure.textContent = meas
        ? ('Cao ' + meas.height.toFixed(2) + 'm · dài tay ' + meas.armLength.toFixed(2) + 'm · dài chân ' + meas.legLength.toFixed(2) +
          'm · rộng vai ' + meas.shoulderWidth.toFixed(2) + 'm · rộng hông ' + meas.hipWidth.toFixed(2) + 'm · tay với ' + meas.armReach.toFixed(2) + 'm')
        : 'Chưa đo — bấm “Guess Markers” để đo số đo cơ thể.';
    }
    if (picklist) {
      var ids = ArpSmart.markerLevel ? LEVELS[ArpSmart.markerLevel] : LEGACY_IDS;
      picklist.innerHTML = ids.map(function (id) {
        var d = lookupMarkerDef(id, ArpSmart.landmarks);
        var placed = false;
        for (var i = 0; i < ArpSmart.markers.length; i++) {
          if (ArpSmart.markers[i].id === id) { placed = true; break; }
        }
        return '<button class="arp-pick' + (ArpSmart.selectedMarkerId === id ? ' selected' : '') + (placed ? ' placed' : '') +
          '" data-pick="' + id + '" title="Chọn marker ' + (d ? d.label : id) + ' để đặt">' + id + '</button>';
      }).join('');
    }
    if (symRes && ArpSmart.lastSymmetry) {
      var s = ArpSmart.lastSymmetry;
      symRes.textContent = s.ok
        ? ('✓ Đối xứng OK — đã kiểm ' + s.checked + ' cặp, lệch lớn nhất dưới ' + (s.threshold * 100).toFixed(0) + 'cm.')
        : ('⚠ Lệch L/R quá ' + (s.threshold * 100).toFixed(0) + 'cm: ' + s.badPairs.map(function (p) {
            return p.pair + ' (Δx ' + (p.dxErr * 100).toFixed(1) + 'cm, Δy ' + (p.dyErr * 100).toFixed(1) + 'cm)';
          }).join('; '));
      symRes.className = 'arp-status' + (s.ok ? '' : ' arp-warn');
    }
    if (!status && !lmList) return;
    if (!ArpSmart.landmarks) {
      if (status) status.textContent = 'Chưa đo landmark — bấm “Guess Markers” để đo trên model đang chọn.';
      if (lmList) lmList.innerHTML = '';
      return;
    }
    var lm = ArpSmart.landmarks;
    var eff = effectiveLandmarks();
    var rel = function (y) { return ((y - lm.groundY) / lm.H).toFixed(2) + 'H'; };
    if (status) {
      status.textContent = 'Cao ' + lm.H.toFixed(2) + 'm · cằm ' + rel(eff.chinY) +
        ' · vai ' + rel(eff.shoulderY) + ' · háng ' + rel(eff.groinY) +
        ' · cổ tay ' + rel(eff.wristY) + ' · mắt cá ' + rel(eff.ankleY) +
        ' · đo được: ' + Object.keys(lm.measured).join(', ') +
        (ArpSmart.overrides ? ' · ĐÃ CHỈNH: ' + Object.keys(ArpSmart.overrides).join(', ') : '') +
        (ArpSmart.settings.addNeck ? ' · Add Neck BẬT' : '') +
        ' · Mức: ' + (ArpSmart.markerLevel || 'mặc định 7') +
        ' · Ghost: ' + (ArpSmart.ghost.visible ? 'BẬT' : 'TẮT') +
        (ArpSmart.manualMode ? ' · MANUAL MODE (chỉ đặt tay)' : '') +
        (ArpSmart.humanoidCheck ? ' · tin cậy humanoid ' + (ArpSmart.humanoidCheck.confidence * 100).toFixed(0) + '%' : '');
    }
    if (lmList) {
      lmList.innerHTML = ArpSmart.markers.map(function (m) {
        var p = m.mesh ? m.mesh.position : (m.position || { x: 0, y: 0, z: 0 });
        var color = m.mesh ? m.mesh.material.color.getHexString() : '888888';
        return '<div class="arp-marker-row' + (m.id === ArpSmart.selectedMarkerId ? ' selected' : '') +
          '" data-marker-row="' + m.id + '" title="Bấm để chọn marker này; bấm đúp marker trong viewport để xóa">' +
          '<span class="arp-marker-dot" style="background:#' + color + '"></span>' +
          m.label + ' — chỉnh <b>' + m.landmarkKey + '</b>' +
          (m.xKey ? ' + ' + m.xKey : '') +
          ' · (' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) + ')</div>';
      }).join('') || '<div class="arp-note">Chưa có marker — bấm “Guess Markers”.</div>';
    }
  };

  ArpSmart.render = function (container) {
    if (!container) return;
    ArpSmart._container = container;
    container.innerHTML =
      '<div class="arp-smart">' +
      '<p class="arp-note">Rig giữ nguyên pipeline Auto Rig Pro (đo landmark → skeleton Mixamo 41 xương → skin → FBX rigged + .py). ' +
      'Đo marker trước, kéo chỉnh nếu cần, rồi bấm Rig.</p>' +
      '<div id="arp-smart-manual" class="arp-status arp-warn" style="display:none">⚠ Manual marker mode — mesh không giống humanoid rõ ràng, Guess Markers đã tắt. ' +
      'Chỉ đặt marker thủ công (Place markers). <button id="arp-smart-exit-manual" class="arp-btn">Thoát Manual mode (đo lại)</button></div>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-guess" class="arp-btn">🎯 Guess Markers</button>' +
      '<button id="arp-smart-rig" class="arp-btn arp-btn-primary">🦴 Rig</button>' +
      '<button id="arp-smart-rerig" class="arp-btn" title="Rig lại trong scene với landmark đã chỉnh (không xuất file)">↻ Rig lại</button>' +
      '</div>' +
      '<div class="arp-row">' +
      '<label class="arp-check">Mức marker: <select id="arp-smart-level">' +
      '<option value="">Mặc định (7 marker)</option>' +
      '<option value="minimal">Minimal (6)</option>' +
      '<option value="standard">Standard (15)</option>' +
      '<option value="full">Full (18)</option>' +
      '</select></label>' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-sym" checked> Symmetrical Character</label>' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-depth"> Use Markers Depth</label>' +
      '</div>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-addneck" class="arp-btn">Add Neck: TẮT</button>' +
      '<button id="arp-smart-restore" class="arp-btn">↩ Restore Last Session</button>' +
      '<button id="arp-smart-cancel" class="arp-btn">✕ Cancel and Delete Markers</button>' +
      '</div>' +
      '<p class="arp-note">Add Neck (fallback): ép tạo xương Neck ở cằm − 0.02H ngay cả khi đo cằm yếu ' +
      '(measured.chin = false) — dùng khi model không có cổ rõ. Khi cằm đo tốt thì nút này không đổi gì.</p>' +
      '<p class="arp-note">Use Markers Depth: khi bật, đặt xương theo độ sâu Z đo từ mesh (depthCz) thay vì tâm Z của bbox.</p>' +
      '<div class="arp-section"><h4>📍 Đặt marker thủ công</h4>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-place" class="arp-btn">📍 Place markers</button>' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-mirror" checked> Mirror khi đặt (trái → phải)</label>' +
      '</div>' +
      '<div id="arp-smart-picklist" class="arp-picklist"></div>' +
      '<p class="arp-note">Bật Place markers rồi bấm trực tiếp lên model để đặt marker đang chọn (tự snap lên bề mặt mesh, ' +
      'mirror sang bên đối xứng nếu bật). Kéo marker để chỉnh vị trí; bấm đúp marker trong viewport để xóa. ' +
      'Khi Place markers bật, camera khóa xoay để không xoay theo tay.</p>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-snap" class="arp-btn">🧲 Snap to surface (marker đang chọn)</button>' +
      '<button id="arp-smart-snap-all" class="arp-btn">🧲 Snap tất cả marker</button>' +
      '<button id="arp-smart-symmetry" class="arp-btn">⚖ Symmetry check (ngưỡng 3cm)</button>' +
      '</div>' +
      '<div id="arp-smart-symmetry-result" class="arp-status" style="display:none"></div>' +
      '</div>' +
      '<div class="arp-section"><h4>📏 Số đo cơ thể (kéo slider để chỉnh trước khi rig)</h4>' +
      '<div id="arp-smart-measure" class="arp-status">Chưa đo — bấm “Guess Markers” để đo số đo cơ thể.</div>' +
      '<div class="arp-slider-row"><label>Rộng vai <span id="arp-smart-slider-shoulderWidth-val">—</span></label>' +
      '<input type="range" id="arp-smart-slider-shoulderWidth" min="0.05" max="0.60" step="0.005" value="0.26"></div>' +
      '<div class="arp-slider-row"><label>Rộng hông <span id="arp-smart-slider-hipWidth-val">—</span></label>' +
      '<input type="range" id="arp-smart-slider-hipWidth" min="0.05" max="0.60" step="0.005" value="0.18"></div>' +
      '<div class="arp-slider-row"><label>Tay với <span id="arp-smart-slider-armReach-val">—</span></label>' +
      '<input type="range" id="arp-smart-slider-armReach" min="0.10" max="1.20" step="0.005" value="0.50"></div>' +
      '<div class="arp-slider-row"><label>Dài chân <span id="arp-smart-slider-legLength-val">—</span></label>' +
      '<input type="range" id="arp-smart-slider-legLength" min="0.30" max="1.50" step="0.005" value="0.90"></div>' +
      '</div>' +
      '<div class="arp-section"><h4>👻 Preview skeleton (ghost) trước khi rig</h4>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-ghost" class="arp-btn">👻 Ghost skeleton</button>' +
      '<button id="arp-smart-regen" class="arp-btn">↻ Regenerate (đo lại từ marker)</button>' +
      '</div>' +
      '<p class="arp-note">Ghost là khung xương cyan trong suốt khớp vị trí marker — chỉ để xem trước, ' +
      'không phải rig thật. Kéo marker thì ghost cập nhật theo thời gian thực. Bấm “Rig” để chốt rig thật.</p>' +
      '</div>' +
      '<div class="arp-section"><h4>⚙️ Tùy chọn rig khi generate</h4>' +
      '<div class="arp-row">' +
      '<label class="arp-check">Số xương: <select id="arp-smart-bonecount">' +
      '<option value="41">41 — đủ Mixamo</option>' +
      '<option value="28">28 — gọn kiểu HY3D</option>' +
      '<option value="15">15 — tối giản</option>' +
      '</select></label>' +
      /* NHÓM 6 — Animal presets: dropdown chọn preset rig (humanoid mặc
         định; quadruped/robot/bird dùng marker + boneDefs riêng, xem
         js/rig/arp-animal-presets.js). */
      '<label class="arp-check">Preset rig: <select id="arp-smart-preset">' +
      '<option value="humanoid">Humanoid — 41 xương Mixamo</option>' +
      '<option value="quadruped">Quadruped — 4 chân (26 xương)</option>' +
      '<option value="robot">Robot — khớp cứng (17 xương)</option>' +
      '<option value="bird">Bird — chim/cánh (23 xương)</option>' +
      '</select></label>' +
      '<label class="arp-check">Tư thế gốc: <select id="arp-smart-pose">' +
      '<option value="T">T-pose (tay ngang 90°)</option>' +
      '<option value="A">A-pose (tay chếch ~45°)</option>' +
      '</select></label>' +
      '</div>' +
      '<div class="arp-row">' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-fingers" checked> Xương ngón tay</label>' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-toes" checked> Xương ngón chân</label>' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-twist"> Twist bone (cẳng tay/cẳng chân)</label>' +
      '</div>' +
      '<div class="arp-row">' +
      '<label class="arp-check">Số đốt sống: <select id="arp-smart-spine">' +
      '<option value="3">3 (Spine/Spine1/Spine2)</option>' +
      '<option value="2">2 (Spine/Spine1)</option>' +
      '<option value="1">1 (Spine)</option>' +
      '</select></label>' +
      '<label class="arp-check">Số đốt cổ: <select id="arp-smart-neckseg">' +
      '<option value="1">1 (Neck)</option>' +
      '<option value="2">2 (Neck/Neck1)</option>' +
      '</select></label>' +
      '</div>' +
      '</div>' +
      '<div class="arp-section"><h4>🔍 Phân tích mesh + Decimation (NHÓM 1)</h4>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-analyze" class="arp-btn">🔍 Phân tích mesh</button>' +
      '<button id="arp-smart-decimate-now" class="arp-btn">✂ Decimate ngay</button>' +
      '</div>' +
      '<div class="arp-row">' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-decimate-on"> Decimate trước khi rig</label>' +
      '<label class="arp-check">Tỉ lệ: <select id="arp-smart-decimate-ratio">' +
      '<option value="0.5">50% tris</option>' +
      '<option value="0.32" selected>32% (~15k tris)</option>' +
      '<option value="0.2">20% tris</option>' +
      '</select></label>' +
      '<label class="arp-check"><input type="checkbox" id="arp-smart-decimate-joints" checked> Giữ chi tiết vùng khớp</label>' +
      '</div>' +
      '<p class="arp-note">“Phân tích mesh” đo hình dạng thật (độ dày chi, số chân chạm đất, đuôi, cánh/sừng, dấu hiệu robot) rồi CHỌN rig phù hợp thay vì ép humanoid 41 xương: humanoid → 41 xương; robot → 28 xương gọn (bỏ ngón); 4 chân/creature → KHÔNG rig humanoid, báo rig cần dùng. “Decimate ngay” giảm tris bằng meshopt (giữ biên/UV/skin, không dùng voxel). Bật “Decimate trước khi rig” thì bấm Rig sẽ decimate trước (1 lần/model).</p>' +
      '<div id="arp-smart-shape-result" class="arp-status">Chưa phân tích — bấm “Phân tích mesh”.</div>' +
      '<div id="arp-smart-decimate-result" class="arp-status">Chưa decimate.</div>' +
      '</div>' +
      '<div class="arp-section"><h4>💾 Marker set (lưu nhiều bộ marker đặt tên)</h4>' +
      '<div class="arp-row">' +
      '<input id="arp-smart-setname" class="arp-input" type="text" placeholder="Tên set, vd: lenhhosung-A-pose">' +
      '<button id="arp-smart-set-save" class="arp-btn">💾 Lưu set này</button>' +
      '</div>' +
      '<div class="arp-row">' +
      '<select id="arp-smart-setlist" class="arp-input"></select>' +
      '<button id="arp-smart-set-load" class="arp-btn">📂 Tải set</button>' +
      '<button id="arp-smart-set-del" class="arp-btn">🗑 Xóa set</button>' +
      '</div>' +
      '<div class="arp-row">' +
      '<button id="arp-smart-export-json" class="arp-btn">⬇ Export JSON (marker hiện tại)</button>' +
      '<label class="arp-btn">⬆ Import JSON <input id="arp-smart-import-file" type="file" accept=".json,application/json" style="display:none"></label>' +
      '</div>' +
      '</div>' +
      '<div id="arp-smart-status" class="arp-status"></div>' +
      '<div id="arp-smart-markers" class="arp-marker-list"></div>' +
      '</div>';
    var $ = function (id) { return container.querySelector('#' + id); };
    var on = function (id, ev, fn) {
      var el = $(id);
      if (el) el.addEventListener(ev, fn);
    };
    on('arp-smart-guess', 'click', function () { ArpSmart.guessMarkers(); });
    /* [NHÓM 1] Phân tích mesh + Decimate (js/rig/arp-decimate.js). */
    on('arp-smart-analyze', 'click', function () { ArpSmart.analyzeShape(); });
    on('arp-smart-decimate-now', 'click', function () { ArpSmart.decimateNow(); });
    on('arp-smart-decimate-on', 'change', function (e) { ArpSmart.setDecimateOpt('enabled', !!e.target.checked); });
    on('arp-smart-decimate-ratio', 'change', function (e) { ArpSmart.setDecimateOpt('ratio', +e.target.value); });
    on('arp-smart-decimate-joints', 'change', function (e) { ArpSmart.setDecimateOpt('protectJoints', !!e.target.checked); });
    on('arp-smart-rig', 'click', function () { ArpSmart.rig(); });
    on('arp-smart-rerig', 'click', function () { ArpSmart.rig({ export: false }); });
    on('arp-smart-addneck', 'click', function () {
      ArpSmart.settings.addNeck = !ArpSmart.settings.addNeck;
      ArpSmart.saveSession();
      ArpSmart._syncControls();
      ArpSmart.refreshReadout();
    });
    on('arp-smart-restore', 'click', function () {
      var r = ArpSmart.restoreSession();
      if (!r.restored) notify('warning', 'Tab Smart', 'Chưa có session nào để khôi phục (' + r.reason + ').');
    });
    on('arp-smart-cancel', 'click', function () { ArpSmart.cancelAndDeleteMarkers(); });
    on('arp-smart-sym', 'change', function (e) {
      ArpSmart.settings.symmetrical = !!e.target.checked;
      ArpSmart.saveSession();
      ArpSmart.refreshReadout();
    });
    on('arp-smart-depth', 'change', function (e) {
      ArpSmart.settings.useDepth = !!e.target.checked;
      ArpSmart.saveSession();
      ArpSmart.refreshReadout();
    });
    on('arp-smart-level', 'change', function (e) {
      ArpSmart.setMarkerLevel(e.target.value || null);
    });
    on('arp-smart-place', 'click', function () { ArpSmart.setPlaceMode(!ArpSmart.placeMode); });
    on('arp-smart-mirror', 'change', function (e) {
      ArpSmart.mirrorEnabled = !!e.target.checked;
      ArpSmart.saveSession();
    });
    on('arp-smart-exit-manual', 'click', function () {
      ArpSmart.setManualMode(false);
      notify('info', 'Tab Smart', 'Đã thoát Manual mode — bấm Guess Markers để đo lại.');
    });
    on('arp-smart-snap', 'click', function () {
      var r = ArpSmart.snapMarkerToSurface(ArpSmart.selectedMarkerId);
      if (!r) notify('warning', 'Tab Smart', 'Không snap được marker “' + ArpSmart.selectedMarkerId + '” — chưa có marker/mesh.');
      else notify('success', 'Snap to surface', 'Marker ' + r.id + ' đã snap lên bề mặt mesh.');
    });
    on('arp-smart-snap-all', 'click', function () {
      var out = ArpSmart.snapAllMarkersToSurface();
      notify('success', 'Snap to surface', 'Đã snap ' + out.length + ' marker lên bề mặt mesh.');
    });
    on('arp-smart-symmetry', 'click', function () {
      var s = ArpSmart.checkSymmetry();
      var el = $('arp-smart-symmetry-result');
      if (el) el.style.display = '';
      ArpSmart.refreshReadout();
      if (!s.ok) notify('warning', 'Symmetry check', 'Có ' + s.badPairs.length + ' cặp lệch quá 3cm: ' + s.badPairs.map(function (p) { return p.pair; }).join(', ') + '.');
      else notify('success', 'Symmetry check', 'Đối xứng OK (' + s.checked + ' cặp đã kiểm).');
    });
    on('arp-smart-ghost', 'click', function () {
      if (ArpSmart.ghost.visible) ArpSmart.hideGhost();
      else ArpSmart.showGhost();
      ArpSmart._syncControls();
      ArpSmart.refreshReadout();
    });
    on('arp-smart-regen', 'click', function () { ArpSmart.regenerateGhost(); });
    on('arp-smart-bonecount', 'change', function (e) { ArpSmart.setRigOpt('boneCount', +e.target.value); });
    /* NHÓM 6 — Animal presets: đổi preset → ghost/marker dùng boneDefs preset đó. */
    on('arp-smart-preset', 'change', function (e) { ArpSmart.setRigOpt('preset', e.target.value); });
    on('arp-smart-pose', 'change', function (e) { ArpSmart.setRigOpt('pose', e.target.value); });
    on('arp-smart-fingers', 'change', function (e) { ArpSmart.setRigOpt('fingers', !!e.target.checked); });
    on('arp-smart-toes', 'change', function (e) { ArpSmart.setRigOpt('toes', !!e.target.checked); });
    on('arp-smart-twist', 'change', function (e) { ArpSmart.setRigOpt('twist', !!e.target.checked); });
    on('arp-smart-spine', 'change', function (e) { ArpSmart.setRigOpt('spineSegments', +e.target.value); });
    on('arp-smart-neckseg', 'change', function (e) { ArpSmart.setRigOpt('neckSegments', +e.target.value); });
    [['arp-smart-slider-shoulderWidth', 'shoulderWidth'], ['arp-smart-slider-hipWidth', 'hipWidth'],
     ['arp-smart-slider-armReach', 'armReach'], ['arp-smart-slider-legLength', 'legLength']].forEach(function (pair) {
      on(pair[0], 'input', function (e) {
        var lab = $(pair[0] + '-val');
        if (lab) lab.textContent = (+e.target.value).toFixed(2) + 'm';
      });
      on(pair[0], 'change', function (e) { ArpSmart.setMeasurement(pair[1], +e.target.value); });
    });
    on('arp-smart-set-save', 'click', function () {
      var input = $('arp-smart-setname');
      var name = input ? input.value : '';
      if (ArpSmart.saveMarkerSet(name)) {
        notify('success', 'Tab Smart', 'Đã lưu marker set "' + String(name).trim() + '".');
        if (input) input.value = '';
      } else notify('warning', 'Tab Smart', 'Chưa lưu được set — nhập tên set và cần có marker.');
    });
    on('arp-smart-set-load', 'click', function () {
      var sel = $('arp-smart-setlist');
      var name = sel ? sel.value : '';
      if (!name) { notify('warning', 'Tab Smart', 'Chưa chọn set nào.'); return; }
      var r = ArpSmart.loadMarkerSet(name);
      if (!r.ok) notify('warning', 'Tab Smart', 'Không tải được set: ' + (r.error || '?'));
    });
    on('arp-smart-set-del', 'click', function () {
      var sel = $('arp-smart-setlist');
      var name = sel ? sel.value : '';
      if (!name) return;
      ArpSmart.deleteMarkerSet(name);
      notify('info', 'Tab Smart', 'Đã xóa marker set "' + name + '".');
    });
    on('arp-smart-export-json', 'click', function () {
      var json = ArpSmart.exportMarkerSetJSON();
      if (!json) { notify('warning', 'Tab Smart', 'Chưa có marker nào để xuất JSON.'); return; }
      if (PixiStudio.Utils && PixiStudio.Utils.downloadText) PixiStudio.Utils.downloadText(json, 'pixistudio-arp-markers.json', 'application/json');
      else notify('info', 'Tab Smart', 'JSON marker set đã tạo (' + json.length + ' ký tự) — trình duyệt không hỗ trợ tải trực tiếp.');
    });
    on('arp-smart-import-file', 'change', function (e) {
      var file = e.target && e.target.files && e.target.files[0];
      if (!file) return;
      if (typeof FileReader === 'undefined') { notify('warning', 'Tab Smart', 'Trình duyệt không hỗ trợ đọc file JSON.'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var r = ArpSmart.importMarkerSetJSON(reader.result);
        if (!r.ok) notify('error', 'Tab Smart', 'Import JSON lỗi: ' + (r.error || '?'));
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    /* Delegation: bấm nút chọn marker trong picklist + bấm dòng marker. */
    container.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute) {
        var pick = t.getAttribute('data-pick');
        if (pick) { ArpSmart.selectMarker(pick); return; }
        var row = t.getAttribute('data-marker-row') || (t.parentNode && t.parentNode.getAttribute && t.parentNode.getAttribute('data-marker-row'));
        if (row) ArpSmart.selectMarker(row);
      }
    });
    ArpSmart._syncControls();
    ArpSmart.refreshReadout();
  };

  /* Test hooks */
  ArpSmart._test = {
    STORAGE_KEY: STORAGE_KEY,
    SETS_KEY: SETS_KEY,
    positionsFromLandmarks: positionsFromLandmarks,
    positionsFromLandmarks17: positionsFromLandmarks17,
    levelDefs: levelDefs,
    lookupMarkerDef: lookupMarkerDef,
    markerPositionFromLandmarks: markerPositionFromLandmarks,
    effectiveLandmarks: effectiveLandmarks,
    getTarget: getTarget,
    nearestVertexOnMesh: nearestVertexOnMesh,
    collectMeshes: collectMeshes,
    LEVELS: LEVELS,
    LEGACY_IDS: LEGACY_IDS,
    ALL_MARKER_DEFS: ALL_MARKER_DEFS
  };

  window.PixiStudio = window.PixiStudio || {};
  window.PixiStudio.ArpSmart = ArpSmart;
})();
