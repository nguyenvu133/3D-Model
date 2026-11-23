# v21.0 “Smart Studio” — Smart Features Report (2026-11-23)

10 tính năng thông minh mới, tất cả chạy local không cần API key.
Panel gom chung: tab Animation → **🧠 Smart Studio** (`js/ui/smart-panel.js`).

## 1. IK Solver hai xương (`js/animation/ik-solver.js`)

- `solveLimb(rig, limb, target, pole)` — luật cosin: góc tại khớp gốc từ
  `cosA = (a² + c² − b²) / 2ac`; hướng gập lấy từ pole vector (thành phần
  vuông góc với hướng tới target), dự phòng giữ hướng gập hiện tại.
- Target ngoài tầm → duỗi thẳng hết cỡ, trả `reached: false` + khoảng lệch.
- `setTarget(limb, x, y, z)` giữ mỗi frame (App tick gọi `IKSolver.update`).
- `plantFeet(rig, groundY)` — nâng model cho bàn chân thấp nhất chạm đất,
  rồi IK từng chân xuống đúng mặt đất.
- Xoay bone bằng vị trí world thật của child (không giả định trục local):
  `deltaQ = setFromUnitVectors(dirHiệnTại, dirMuốn)` rồi đổi về local qua
  nghịch đảo world quaternion của parent.
- Chi hỗ trợ: LeftArm / RightArm / LeftLeg / RightLeg (tên chuẩn, khớp cả
  prefix `mixamorig:`). Rig chưa có → trả `{ok:false}`.

## 2. Animation Blender (`js/animation/anim-blender.js`)

- `blend(fromId, toId, duration)` — 2 action cùng chạy, `update(dt)` ramp
  weight 1→0 / 0→1; xong dừng action cũ, emit `anim:blend-done`.
- `maskBlend(baseId, overlayId, 'upper'|'lower', weight)` — lọc track theo
  tên bone (`maskedClip`), phát overlay song song với clip nền.
- `additive(baseId, addId, weight)` — `makeAdditive` trừ keyframe đầu
  (quaternion: `q_ref⁻¹ * q`; vector: `v − v_ref`) rồi phát với
  `AdditiveAnimationBlendMode` (nếu action hỗ trợ).
- `stopOverlays()` dừng mọi overlay.

## 3. Pose Library (`js/animation/pose-library.js`)

- `capture()` → `{bones: {name:[x,y,z,w]}, root:[x,y,z]}`;
  `apply(pose)`, `interpolate(a, b, t)` (slerp từng quaternion, lerp root).
- `save/load/list/delete` qua localStorage `pixiStudio.poses.v21`.
- Pose mẫu dạng delta xoay tương đối: T-Pose (±77° vai), A-Pose (±34°),
  Crouch (hông +20°, đùi −34°, gối +52°). Góc là gần đúng theo rig AutoGen.

## 4. Export Presets (`js/exporter/export-presets.js`)

| Preset | Format | Version | Up | Auto-scale | Ghi chú |
|---|---|---|---|---|---|
| Mixamo | FBX | 7300 | Y | có | Mixamo chỉ nhận ≤2013 |
| Unity | FBX | 7400 | Y | có | mét, import mặc định |
| Unreal | FBX | 7400 | Z | có | Z-up; cm chỉnh ở Import |
| Godot | GLB | — | Y | có | GLB, import thẳng |
| Roblox | FBX | 7300 | Y | có | Avatar Importer R15 |

- `SaveManager.setExportPreset(id)` + `SaveManager.exportPreset` (mặc định
  `null` = giữ hành vi cũ). Áp vào `saveFBXBinary` (xuất FBX generic):
  version/upAxis/autoScale + hậu tố tên file. Nút Save Mixamo giữ cố định
  7300/Y vì Mixamo bắt buộc.

## 5. Auto-LOD local (`js/mesh/lod-generator.js`)

- `decimate(geometry, ratio)` — vertex clustering: gom đỉnh vào ô lưới
  `cell = diag * 0.02 / ratio`, trung bình vị trí, bỏ tam giác suy biến,
  `computeVertexNormals()`. Hỗ trợ geometry có/không có index.
- `generateLODs(mesh, [1, 0.5, 0.25])`, `applyLOD` / `restoreLOD`
  (gốc giữ trong `userData.__lodOriginal`), `report()`.

## 6. Turntable (`js/renderer/turntable.js`)

- `angles(steps, startDeg, totalDeg)` — danh sách góc chụp.
- `start(target, {steps, totalDeg, intervalMs})` xoay từng bước
  (setTimeout 140ms để renderer kịp vẽ) + `captureFrame()` qua
  `ThreeRenderer.renderer.domElement.toDataURL`; `next()` tiến 1 bước,
  `stop()` trả yaw về ban đầu. Emit `turntable:frame/stopped`.

## 7. Character Controller (`js/rigging/character-controller.js`)

- `attach(rig)` + `setEnabled(true)`: WASD / mũi tên di chuyển, Shift chạy
  (4.2 m/s vs đi 1.6 m/s), Space nhảy (v=5, g=−12), xoay nhân vật về
  hướng di chuyển (lerp yaw), tự đổi clip Idle/Walk/Run qua
  `AnimAutoGen.play`. `setInput({...})` để test không cần bàn phím.
- Di chuyển `rig.target.position`; nhảy theo `groundY` lúc attach.

## 8. Scene Director (`js/scene/scene-director.js`)

- `groundSnap(obj)` — bbox min.y về 0.
- `layout(objects, 'row'|'circle'|'grid', gap)` — khoảng cách từ kích
  thước thật từng model; circle quay mặt vào tâm.
- `frameCamera(camera, target, fov)` — camera thường (tính từ bbox + FOV).
- `frameOrbit(orbit, objects)` — đặt `dTarget/dRadius` của OrbitCam
  (đúng cách vì OrbitCam tự tính lại vị trí camera mỗi frame).
- `stage(objects, view, mode, gap)` — snap + layout + frame (nhận cả
  OrbitCam lẫn camera thường). Không reparent object khi tính bbox chung.

## 9. Mở rộng sẵn có

- `js/core/history.js` — snapshot kèm pose xương (`pose.bones` +
  `pose.root`); `apply()` khôi phục cả tư thế; thêm `History.pushPose()`.
- `js/performance/monitor.js` — `budgets {tris: 50000, calls: 150,
  fps: 30}`; `checkBudgets(fps, calls, tris)` thuần; `checkBudgetsLive`
  gọi từ `tick`, emit `perf:budget` + notify (chống spam 8s) khi đổi.

## 10. Kiểm thử

`node /tmp/test-fbx/test-smart-v21.js` — IK (chạm target, pole đổi hướng
gập, ngoài tầm), Blender (ramp, mask lọc track, additive trung hòa pose
gốc), Pose (capture/apply roundtrip, interpolate, builtin), Presets
(bảng + writeOpts), LOD (giảm tris, mức đơn điệu), Turntable (góc, bước),
Controller (đi/chạy/nhảy), Director (snap/layout/frame), History pose
undo, Monitor budgets. Regression: `test-meshy.js` 73/73,
`test-rig-anim.js` 80/80. Server smoke: index + file mới HTTP 200.

## 11. Giới hạn đã biết

- IK là giải 1 lần / mỗi frame cho chi đã chọn, không phải full-body IK;
  xoay bone ghi đè lên animation đang chạy (mixer vẫn chạy clip nền).
- Pose mẫu T/A/Crouch là delta gần đúng theo rig AutoGen, có thể cần
  chỉnh tay với model khác tỉ lệ.
- Additive dựa vào `blendMode` của three r128; nếu action không hỗ trợ,
  clip vẫn phát dạng thường (không báo lỗi).
- Turntable chụp `toDataURL` cần canvas không bị taint (texture CORS);
  nếu texture cross-origin không có CORS thì frame đó `dataUrl: null`
  nhưng góc xoay vẫn đúng.
- LOD clustering không giữ UV/normal gốc (tính lại normal); chỉ dùng
  cho preview / xuất LOD, không thay material.
- Unreal preset: đơn vị cm vẫn cần chỉnh ở cửa sổ Import của Unreal
  (Convert Scene Unit) — writer không nhân scale 100.
