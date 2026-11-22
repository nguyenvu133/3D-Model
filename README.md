# PixiJS Studio × Tripo3D AI Studio — v20.0 “Mixamo Ready”

> **All-in-One 3D Game Creation Environment** — Môi trường phát triển game 2D/3D Hybrid chạy hoàn toàn trên trình duyệt, không cần build tool, không cần TypeScript, 100% JavaScript thuần (Vanilla JS).

| | |
|---|---|
| **Phiên bản** | v20.0.0 (“Mixamo Ready”, 2026-11-22 — nâng cấp từ v10.0.0) |
| **Engine** | PixiJS v7 (2D Overlay / Game Layer) + Three.js r128 (3D Viewport) |
| **Render** | WebGL 2.0 / WebGL 1.0 (WebGPU auto-detect — sẵn sàng khi trình duyệt hỗ trợ) |
| **Model mẫu chuẩn** | `assets/models/kiemhiep.glb` — 10.94 MB, 1 nhân vật võ hiệp chibi (đã xoá 3 bản sao, −38.8%) |
| **Ngôn ngữ** | JavaScript thuần (IIFE + Namespace pattern, **không** ES Modules bắt buộc) |
| **Build** | ❌ Không cần — mở `index.html` hoặc chạy `server.bat` là chạy ngay |

---

## ✨ Có gì mới trong v20.0 “Mixamo Ready” (2026-11-22)

- **FBX Mixamo — xương đi theo mesh:** `js/exporter/fbx-binary.js` giờ áp phép biến đổi (xoay/dịch/scale về cao ~1.8) cho cả xương, Cluster TransformLink và BindPose, không chỉ geometry. Trước đây model cao 0.5 xuất ra mesh 1.8 nhưng Hips vẫn ở y=0.25 — Mixamo/Blender skin sai.
- **FBX Mixamo — tự nhận trục dọc:** `upAxis: 'Y'` (mặc định) giờ tự nhận trục dài nhất làm trục dọc. Model Z-up/X-up từ GLB Tripo/Meshy không còn xuất ra nằm ngang.
- **FBX Mixamo — sửa dấu xoay X-up:** +90° thay vì −90° (dấu cũ lộn ngược nhân vật, đầu ở y=0).
- **Mới — Mixamo Pre-flight** (`js/exporter/mixamo-validator.js`): kiểm tra model ngay trong studio trước khi xuất FBX — số tam giác (giới hạn 50.000), chiều cao, xương `mixamorig:*`, skin, texture — lỗi chặn thì không xuất, cảnh báo thì hiện trong thông báo Save Mixamo / Save Mixamo Rig.
- **Mới — “Có gì mới v20.0”:** hộp thoại hiện 1 lần sau khi nâng cấp (nhớ bằng `State.settings.seenVersion`), mở lại bất cứ lúc nào bằng nút **What's New** trên topbar.
- **Phiên bản thống nhất 20.0.0:** số hiệu giờ chỉ định nghĩa ở một chỗ duy nhất — `js/core/version.js` (`PixiStudio.VERSION`, `RELEASE`, `CHANGELOG_V20`) — và được dùng chung cho console boot, About, FBX Creator, Exporter, server banner. Trước đây chỗ v5.0, chỗ v10.0.
- **Kiểm thử:** `npm run qa:mixamo` (validator FBX), `npm run check` (verify cuối), `npm run verify:anim`. Xem chi tiết trong `docs/V20_UPGRADE_REPORT.md`.

---

## 📑 Mục lục

1. [Giới thiệu tổng quan](#1-giới-thiệu-tổng-quan)
2. [Tính năng đầy đủ](#2-tính-năng-đầy-đủ)
3. [Cài đặt & Chạy dự án](#3-cài-dat--chạy-dự-án)
4. [Model mẫu chuẩn — kiemhiep.glb](#4-model-mẫu-chuẩn--kiemhiepglb)
5. [Kiến trúc thư mục](#5-kiến-trúc-thư-mục)
6. [Tài liệu Module & API](#6-tài-liệu-module--api)
7. [Lộ trình phát triển theo Phase](#7-lộ-trình-phát-triển-theo-phase)
8. [Responsive — Hỗ trợ mọi kích cỡ màn hình](#8-responsive--hỗ-trợ-mọi-kích-cỡ-màn-hình)
9. [Giao diện — Bố cục chuẩn theo ảnh tham chiếu](#9-giao-diện--bố-cục-chuẩn-theo-ảnh-tham-chiếu)
10. [Phím tắt (Keyboard Shortcuts)](#10-phím-tắt-keyboard-shortcuts)
11. [Tích hợp backend Tripo3D AI sau này](#11-tích-hợp-backend-tripo3d-ai-sau-này)
12. [Giới hạn thực tế của Prototype (Trạng thái trung thực)](#12-giới-hạn-thực-tế-của-prototype-trạng-thái-trung-thực)
13. [Lộ trình tương lai — Roadmap v5.1+](#13-lộ-trình-tương-lai--roadmap-v51)
14. [SAVE CENTER — Lưu & tối ưu file đa định dạng](#14-save-center--lưu--tối-ưu-file-đa-định-dạng)
15. [Giấy phép](#15-giấy-phép)

---

## 1. Giới thiệu tổng quan

**PixiJS Studio × Tripo3D AI Studio v20.0** là một *phần mềm 3D Studio* chạy trên web, mô phỏng trải nghiệm làm việc của Blender / Maya / Unity Editor nhưng:

- Chạy 100% trong trình duyệt — không cài đặt, không build, không server bắt buộc.
- Kết hợp **PixiJS** (2D engine — layer hiệu ứng, sprite, game runtime) và **Three.js** (3D rendering, GLB loading, animation skeleton).
- Chuẩn bị sẵn **Adapter** để kết nối **Tripo3D AI** (Text-to-3D, Image-to-3D) ở giai đoạn sau mà không phải sửa lại kiến trúc.
- Đi kèm **model mẫu chuẩn `kiemhiep.glb`** — nhân vật võ hiệp chibi dùng làm chuẩn kiểm thử cho toàn pipeline: Import → Inspector → Auto Rig → Animation → Material → Export → Game Ready.

### Ảnh tham chiếu giao diện

Bố cục chuẩn bị sao chép từ ảnh `Futuristic 3D Chibi Studio Dashboard.png`:

- **TOP BAR**: Logo PixiJS + Tripo3D.AI Studio (Pro) + badge v20.0 + menu Studio/Model/Rig/Animation/Scene/Material/Render/Game/Tools/Settings + Local/Save/Export/Upgrade + Window Controls + nút What's New (v20.0).
- **LEFT TOOLBAR** (icon rail): Assets, Model, Rig, Animation, Material, Scene, Render, Export, AI Tools.
- **ASSET LIBRARY**: tìm kiếm, bộ lọc, danh mục, grid thumbnail, Import 3D/Image/FBX/GLB, Model Tools.
- **CENTRAL 3D VIEWPORT**: 4 góc nhìn nhân vật (Front/Left/Right/Back), lưới 3D, vòng sáng dưới chân, axis gizmo, transform gizmo.
- **TRIPO AI CARD**: card nổi bên phải viewport với checklist AI + nút Generate.
- **RIGHT INSPECTOR**: Inspector/Scene — Model Info, Transform, Material, Animation, Physics.
- **BOTTOM TIMELINE**: Timeline/Animation Graph/Blend Shapes/Constraints + playback controls + keyframe tracks.
- **BOTTOM RIGHT**: Render & Export + Game Ready cards.

### Triết lý kỹ thuật

| Nguyên tắc | Diễn giải |
|---|---|
| **Thuần JS** | Không TypeScript, không Vite, không Webpack. Mỗi module là 1 file `.js` dùng IIFE, gắn vào namespace `window.PixiStudio`. |
| **Module độc lập** | Mỗi module có API riêng, giao tiếp qua `EventBus` — bỏ 1 module không làm vỡ app. |
| **Trung thực** | Tính năng chưa có backend/AI thật **phải** hiển thị trạng thái "chưa kết nối / chưa hỗ trợ" — tuyệt đối không giả lập kết quả thành công. |
| **Responsive trước** | Resize panel bằng tay + media query cho mọi loại màn hình từ 360px → 4K. |
| **Chạy được thật** | Mọi nút đều có sự kiện, mọi panel đều chuyển đổi được, viewport hiển thị model thật (GLB thật + chibi procedural dự phòng). |

---

## 2. Tính năng đầy đủ

### 🧭 Workspace & UI
- Dark theme chuyên nghiệp `#111116 / #1B1B24 / #252530`, accent tím `#713BFF`, xanh `#27BFFF`.
- 10 workspace tab (Studio → Settings) — mỗi tab đổi nội dung panel trái theo module.
- Icon rail thu gọn được (`Tab`), panel resize bằng kéo thả, tooltip mọi icon.
- Context menu chuột phải, toast notification, modal system, loading progress.
- Undo/Redo (snapshot transform), Autosave 60s vào `localStorage`, Project Manager (nhiều save slot).
- Keyboard shortcuts toàn cục.

### 📦 Asset Library
- Dữ liệu mẫu: 9 nhân vật võ hiệp chibi (variant màu/trang phục tự sinh), vũ khí, prop, environment, FX.
- **Thumbnail thật được render 3D offscreen** từ chính engine (không phải ảnh giả).
- Tìm kiếm, chip lọc danh mục, import file, drag & drop file vào library/viewport.
- Import thực: **GLB, GLTF, OBJ, STL**, ảnh (PNG/JPG/WebP/SVG), audio (WAV/MP3/OGG). FBX → thông báo trung thực (cần backend chuyển đổi).
- Model Tools: Auto Rig, Auto Animate, Mesh Optimize (merge thật), Texture Bake, Retopology, LOD, Collider Generator (tạo collider wireframe thật), UV Unwrap.

### 🎥 3D Viewport
- Load **GLB thật** (`kiemhiep.glb`) qua `THREE.GLTFLoader`.
- 9 chế độ camera: Perspective, Ortho, Front, Back, Left, Right, Top, Bottom, **Quad View** (4 góc nhìn giống ảnh tham chiếu).
- Orbit/Pan/Zoom tự viết (không phụ thuộc OrbitControls), damping mượt, Focus (`F`) tự tính bounding box.
- Lưới 3D + trục toạ độ, **axis gizmo 3D thật** ở góc phải trên (quay theo camera).
- Studio lighting: key/fill/rim + hemisphere, shadow map, tone mapping ACES.
- **Vòng sáng tím dưới chân nhân vật** + nền gradient + hạt bụi PixiJS bay quanh viewport.
- Transform Gizmo (Move/Rotate/Scale — W/E/R), wireframe/solid/xray toggle, skeleton preview.
- Screenshot PNG 1 click, render offscreen độ phân giải tuỳ chọn (720p → 4K).

### 🦴 Rigging Studio
- Skeleton logic hoàn chỉnh: Bone class, hierarchy, 6 preset (Mixamo Compatible, Human Basic, Human Advanced, Game Character, Stylized, Custom).
- **Auto Rig**: phân tích bounding box model → sinh bộ xương humanoid tỷ lệ đúng model.
- Visual skeleton: khớp cầu + xương bát diện, chọn bone bằng click, rename/mirror.
- Bone Editor: Root → Hips → Spine → Chest → Neck → Head → Shoulder → Arm → Hand → Leg → Foot → Toe.
- IK/FK, weight paint, skin binding: **trạng thái trung thực** (cần backend/skinned model).

### 🎬 Animation Studio
- Player thật cho GLB có sẵn animation clip (mixer, play/pause/stop/speed/loop, crossfade).
- 16 preset animation procedural (Idle, Walk, Run, Jump, Attack, Heavy Attack, Combo, Block, Dodge, Roll, Hit, Death, Victory, Dance, Skill, Magic) sinh `THREE.AnimationClip` thật cho skeleton mẫu.
- Retarget theo tên bone phổ biến (mixamorig/Hips/…) khi GLB có skeleton.

### ⏱ Timeline
- Ruler, playhead, scrubbing, zoom (px/frame), FPS selector (12/24/30/60), frame counter.
- 6 loại track: Position, Rotation, Scale, Bone, Facial, Camera — keyframe hình thoi nhiều màu (đúng ảnh).
- Add/Delete/Copy/Paste keyframe, kéo keyframe đổi frame, snap.
- **Animation Graph**: curve editor vẽ thật dữ liệu keyframe (linear interpolation).
- Playback thật: áp transform lên object theo frame — timeline điều khiển được model.

### 🎨 Material & Texture Studio
- 8 loại material: PBR Standard, Toon, Cel, Stylized, Water, Glass, Metal, Emissive.
- Edit thật: base color, metallic, roughness, emissive, opacity, flat shading, wireframe, side.
- Texture slots: BaseColor/Normal/Roughness/AO/Emission/Height — gán texture từ ảnh import.
- UV preview, texture list, texture bake (bake preview thật bằng offscreen render).

### 🌳 Scene Editor
- Hierarchy thật: Scene → Camera, Lights, Character, Armature, Ground, Effects…
- Create (Box/Sphere/Plane/Cylinder/Cone/Torus/Light), Duplicate, Delete, Rename, Group, Lock, Hide, Multi-select, Drag&Drop re-parent.

### ⚡ Physics (Prototype nhẹ)
- Rigidbody properties: mass, gravity, friction, bounciness, collider Box/Sphere/Capsule (visualize wireframe thật).
- Mini-sim: rơi tự do + nảy trên mặt đất với restitution thật. Full engine → trạng thái trung thực.

### 🤖 Tripo3D AI Module
- Panel đầy đủ: Text-to-3D (prompt, negative prompt, style, quality, polygon, texture res), Image-to-3D (front/side/back/multi-view), AI tools checklist.
- **Adapter `TripoAdapter`** chuẩn bị sẵn REST gọi thật tới `api.tripo3d.ai` khi người dùng nhập API key + endpoint — có queue, progress, task polling.
- **Chưa nhập key ⇒ mọi nút Generate hiển thị trạng thái "chưa kết nối"** — không giả lập kết quả. Local model manager, VRAM/RAM monitor (đọc số liệu thật nếu trình duyệt hỗ trợ), prompt history.

### 🚀 Render & Export
- Render engine selector: WebGL (Three), PixiJS overlay, WebGPU detect.
- Render settings: resolution (720p→4K), AA, shadow, AO, HDR/bloom (tone mapping), transparent.
- Export thật: **GLB (GLTFExporter binary), GLTF, OBJ (OBJExporter), STL, PNG, JPG, WebP, Project JSON, Video WebM (MediaRecorder)**.
- GIF/MP4/FBX export: **trạng thái trung thực** — cần encoder ngoài (đã ghi rõ hướng dẫn).

### 🎮 Game Ready
- Checklist platform + nút **Build Game** sinh gói JSON manifest (assets, config runtime PixiJS) — nền cho runtime loader sau này.
- PixiJS Integration layer đã có: 2D overlay runtime chạy thật (particles, sparkle khi select), sprite generation từ viewport.

### 📊 Performance Monitor
- Đọc số liệu **thật** từ `renderer.info`: FPS, Draw Calls, Triangles, Geometries, Textures, Render time.
- FPS graph canvas thời gian thực, cảnh báo vượt ngưỡng (60/30 FPS), VRAM heuristic + `performance.memory` nếu có.

---

## 3. Cài đặt & Chạy dự án

### Cách 1 — Server local (khuyến nghị, bắt buộc để load GLB)

Do chính sách CORS của trình duyệt, load file `.glb` qua `fetch` **chỉ hoạt động khi chạy qua HTTP**:

```
1. Double-click server.bat          (cần Python hoặc Node.js trong PATH)
2. Mở trình duyệt: http://localhost:8080
```

Hoặc tự chạy:

```bash
# Python 3
python -m http.server 8080

# hoặc Node.js
npx serve -l 8080 .
```

### Cách 2 — Mở trực tiếp `index.html`

App vẫn chạy được (UI, viewport chibi mẫu, mọi module) nhưng:
- ❌ Không auto-load được `kiemhiep.glb` (CORS của `file://`)
- ✅ Vẫn import được GLB bằng **kéo-thả file** hoặc nút Import (FileReader, không cần HTTP)
- ✅ Engine tự động fallback sang **chibi võ hya procedural** dựng bằng primitives và thông báo rõ cho người dùng.

### Thư viện ngoài (CDN, có fallback)

| Thư viện | Bản | Nguồn chính | Fallback |
|---|---|---|---|
| three.js | r128 | cdn.jsdelivr.net | unpkg.com |
| GLTFLoader/OBJLoader/STLLoader | r128 examples | cdn.jsdelivr.net | unpkg.com |
| TransformControls / GLTFExporter / OBJExporter / STLExporter | r128 examples | cdn.jsdelivr.net | unpkg.com |
| pixi.js | v7.3.2 (UMD) | cdn.jsdelivr.net | unpkg.com |

Nếu muốn chạy **offline hoàn toàn**: tải các file trên vào `js/vendor/` và sửa `<script src>` trong `index.html` (đã ghi chú sẵn vị trí).

---

## 4. Model mẫu chuẩn — kiemhiep.glb

Nhân vật võ hiệp chibi là **chuẩn kiểm thử (golden sample)** cho toàn pipeline:

```
assets/models/kiemhiep.glb              10.94 MB — 1 nhân vật duy nhất (đã làm sạch)
assets/models/kiemhiep-full-backup.glb  17.86 MB — bản gốc 4 nhân vật (backup tự động)
```

### Đã làm sạch — xoá 3 nhân vật trùng lặp (v5.0.1)

File gốc chứa **4 bản sao giống nhau của cùng một nhân vật** (front/left/right/back — đúng phong cách ảnh dashboard). Script `tools/clean-kiemhiep.js` đã:

1. Decode `EXT_meshopt_compression` bằng WASM meshopt (Node)
2. Phát hiện 4 cụm nhân vật theo trục Z (histogram peak/minima, 991.839 verts)
3. Xác minh trùng lặp (so verts + bbox: height 100% khớp)
4. Giữ 1 nhân vật gần tâm — xoá 3 bản sao (bỏ 1.428.808 triangle thừa)
5. Recenter về gốc (tâm X/Z = 0, đáy chạm y=0)
6. Re-encode meshopt — **round-trip position lossless 0.00e+0**

```
Trước : 17.86 MB — 991.839 verts — 1.897.430 tris — 4 nhân vật
Sau   : 10.94 MB — 244.865 verts —   468.622 tris — 1 nhân vật  (−38.8%)
```

Chạy lại bất cứ lúc nào: `node tools/clean-kiemhiep.js` (backup gốc được giữ nguyên). Inspect chi tiết: `node tools/inspect-glb.js`.

### Chuỗi khởi động model

```
Boot app
  ├─① ModelManager.loadDefault()
  │     fetch('assets/models/kiemhiep.glb')   ← ưu tiên cao nhất
  │       ├─ OK   → GLTFLoader + MeshoptDecoder parse → normalize (height ≈ 2.0u)
  │       │         → đặt chân chạm lưới (minY = 0) → add scene → select
  │       └─ Fail → ② SampleModel.createChibiWuxia() (procedural chibi võ lâm)
  │                  + Notification cảnh báo trung thực + hướng dẫn chạy server.bat
  └─③ Mọi model load xong đều phát sự kiện 'model:loaded'
        → Inspector cập nhật (faces/verts/tris/materials/size)
        → Asset Library highlight card tương ứng
        → Timeline nhận danh sách animation clip của GLB (nếu có)
```

### Quy ước normalize

| Bước | Quy tắc |
|---|---|
| Scale | Bounding box chiều cao chuẩn hoá về `2.0` đơn vị (1 unit ≈ 1m) |
| Vị trí | Tâm X/Z = 0, đáy bbox chạm lưới (y=0) |
| Tên | `Hero_001` (đổi được qua Inspector) |
| Vòng sáng | Ring glow tím + shadow render dưới chân tự sinh |

### Thay model mẫu khác

Đổi path trong `js/models/model-manager.js`:

```js
DEFAULT_MODEL_URL: 'assets/models/kiemhiep.glb'   // ← đổi đường dẫn tại đây
```

Hoặc bỏ file `kiemhiep.glb` bất kỳ vào `assets/models/` rồi dùng nút **Import** — mọi GLB/GLTF/OBJ/STL đều import được như nhau.

---

## 5. Kiến trúc thư mục

```
3D Model/
├── README.md                  ← file này
├── index.html                 ← entry point: toàn bộ markup + thứ tự load script
├── server.bat                 ← chạy server local 1 click (Windows)
│
├── css/                       ← 6 file CSS tách theo vùng giao diện
│   ├── main.css               ← design tokens (màu/space), reset, typography, scrollbar
│   ├── layout.css             ← grid workspace, topbar, toolbar, panel columns, statusbar
│   ├── components.css         ← button, input, select, tabs, chip, toggle, tooltip, context menu
│   ├── panels.css             ← asset library, inspector, tripo AI card, modals, notifications
│   ├── timeline.css           ← ruler, tracks, keyframes, playhead, graph
│   └── responsive.css         ← 6 breakpoint: 4K → mobile (mọi kích cỡ màn hình)
│
├── tools/                     ← Node.js scripts (cần npm install meshoptimizer)
│   ├── inspect-glb.js         ← mổ xẻ GLB: chunks/nodes/accessors + histogram cluster
│   └── clean-kiemhiep.js      ← xoá nhân vật trùng lặp + re-encode meshopt + backup
│
├── js/                        ← 40+ module JS thuần (IIFE, namespace PixiStudio.*)
│   ├── core/
│   │   ├── utils.js           ← DOM helper, uid, format, download, DOMPurify-free safe text
│   │   ├── events.js          ← EventBus toàn cục (on/off/once/emit)
│   │   ├── state.js           ← App state trung tâm + settings
│   │   ├── storage.js         ← localStorage, autosave, project slots
│   │   ├── history.js         ← Undo/Redo snapshot engine
│   │   └── app.js             ← Bootstrap: init thứ tự module + render loop + wiring
│   │
│   ├── renderer/
│   │   ├── three-renderer.js  ← WebGL context, shadow, tone mapping, scissor quad
│   │   ├── pixi-renderer.js   ← PixiJS v7 overlay layer (particles 2D thật)
│   │   └── renderer-manager.js← chọn backend, resize, render dispatch
│   │
│   ├── viewport/
│   │   ├── viewport.js        ← sở hữu scene, view modes (9 mode + quad), picking, screenshot
│   │   ├── camera.js          ← OrbitCam tự viết: orbit/pan/zoom/focus/damping + ortho set
│   │   ├── controls.js        ← pointer/touch input, chọn object, gizmo mode
│   │   ├── grid.js            ← grid 3D, trục, ground glow ring, particles holder
│   │   ├── lighting.js        ← studio 3-point lighting + shadow config
│   │   └── gizmo.js           ← TransformControls wrapper + axis gizmo 3D góc phải
│   │
│   ├── models/
│   │   ├── model-manager.js   ← registry model, stats thật (faces/verts/tris/mats), normalize
│   │   └── sample-model.js    ← chibi võ lâm procedural (fallback + 9 variant thumbnail)
│   │
│   ├── assets/
│   │   ├── asset-library.js   ← UI library, tìm kiếm/lọc/danh mục, thumbnail 3D thật
│   │   └── importers.js       ← pipeline import GLB/GLTF/OBJ/STL/ảnh/audio + drag&drop
│   │
│   ├── rigging/
│   │   ├── skeleton.js        ← Bone class + 6 preset skeleton humanoid
│   │   ├── rig-manager.js     ← Auto Rig từ bbox, visual skeleton, bone picking
│   │   └── bone-editor.js     ← UI bone list, rename, mirror
│   │
│   ├── animation/
│   │   ├── animation-manager.js ← mixer, clip list, play/speed/loop, crossfade
│   │   └── presets.js         ← 16 preset procedural clip generator
│   │
│   ├── materials/
│   │   └── material-manager.js← 8 shader type, tham số PBR thật, apply toàn model
│   ├── textures/
│   │   └── texture-manager.js ← texture slots, UV preview, bake preview
│   ├── scene/
│   │   └── scene-manager.js   ← hierarchy registry, CRUD object, re-parent
│   ├── physics/
│   │   └── physics-manager.js ← props, collider visualize, mini gravity sim
│   │
│   ├── ai/
│   │   ├── tripo-adapter.js   ← Adapter REST Tripo (kết nối khi có key) + queue trung thực
│   │   └── ai-panel.js        ← UI Text/Image-to-3D, local model manager, VRAM monitor
│   │
│   ├── timeline/
│   │   ├── keyframes.js       ← track/key store + interpolation + apply transform
│   │   ├── playback.js        ← playhead, fps, loop, frame↔time
│   │   └── timeline.js        ← UI ruler/track/diamond/graph editor
│   │
│   ├── inspector/
│   │   └── inspector.js       ← Inspector/Scene/Properties/Performance tabs, bind selection
│   ├── exporter/
│   │   ├── exporter.js        ← GLB/GLTF/OBJ/STL/ảnh/JSON/WebM + render preset độ phân giải
│   │   ├── glb-writer.js      ← GLB writer riêng: weld + quantize + texture WebP/JPEG resize
│   │   ├── zip-writer.js      ← ZIP STORE thuần JS (bundle GLB+textures+manifest)
│   │   └── save-manager.js    ← SAVE CENTER: 16 formats, 6 presets, history, verify, batch
│   ├── performance/
│   │   └── monitor.js         ← FPS meter, renderer.info, graph, cảnh báo
│   │
│   ├── ui/
│   │   ├── topbar.js          ← menu tabs, save/export/upgrade, window controls
│   │   ├── toolbar.js         ← icon rail + active state + tooltip
│   │   ├── panels.js          ← resizer, collapse, tabs, context menu
│   │   ├── notifications.js   ← toast + loading overlay progress
│   │   ├── modals.js          ← modal system, settings, project manager, about
│   │   └── shortcuts.js       ← keyboard shortcuts toàn cục
│   │
│   └── main.js                ← DOMContentLoaded → PixiStudio.boot()
│
├── assets/
│   └── models/
│       └── kiemhiep.glb       ← ★ MODEL MẪU CHUẨN (copy từ "kiem hiep.glb")
│
└── docs/
    └── PHASES.md              ← checklist lộ trình theo phase
```

---

## 6. Tài liệu Module & API

Tất cả module gắn vào namespace toàn cục `PixiStudio` và giao tiếp qua `PixiStudio.bus` (EventBus). Quy ước sự kiện:

| Sự kiện | Payload | Phát bởi |
|---|---|---|
| `model:loaded` | `{id, name, stats, isGLB}` | ModelManager |
| `model:removed` | `{id}` | ModelManager |
| `selection:changed` | `{object3D, id, name}` | Viewport/Scene |
| `transform:changed` | `{id, position, rotation, scale}` | Gizmo/Inspector |
| `timeline:frame` | `{frame, fps, playing}` | Playback |
| `timeline:key` | `{trackId, frame}` | Keyframes |
| `material:updated` | `{id, params}` | MaterialManager |
| `rig:created` | `{boneCount, preset}` | RigManager |
| `animation:clip` | `{name, duration}` | AnimationManager |
| `ai:task` | `{id, state, progress}` | TripoAdapter |
| `perf:sample` | `{fps, calls, tris}` | Monitor |
| `notify` | `{type, message}` | mọi module |

### API chính của từng module (rút gọn)

```js
// Core
PixiStudio.bus.on(evt, fn) / emit(evt, data)
PixiStudio.state.get('selection') / set('selection', obj)
PixiStudio.storage.saveProject(name) / loadProject(name) / listProjects()
PixiStudio.history.push(label, snapshotFn) / undo() / redo()

// Renderer
PixiStudio.Renderer.three    // THREE.WebGLRenderer
PixiStudio.Renderer.setRenderer('webgl'|'pixi')

// Viewport
PixiStudio.Viewport.init(container)
PixiStudio.Viewport.setView('perspective'|'quad'|'front'|'back'|'left'|'right'|'top'|'bottom'|'ortho')
PixiStudio.Viewport.toggleGrid() / toggleWireframe() / screenshot() / focusSelected()

// Models
PixiStudio.Models.loadURL(url) / loadGLB(arrayBuffer, name) / getStats(object3D)
PixiStudio.Models.Sample.createChibiWuxia(variant)

// Assets
PixiStudio.Assets.Library.render() / search(keyword) / filterCategory(cat)
PixiStudio.Assets.Importers.importFiles(fileList)

// Rigging
PixiStudio.Rig.autoRig(object3D, presetName) / setPreset(name) / selectBone(name)
PixiStudio.Rig.Bones.PRESETS  // 6 preset

// Animation
PixiStudio.Anim.play(name) / pause() / stop() / setSpeed(x) / setLoop(bool)
PixiStudio.Anim.presets      // 16 preset clip generator
PixiStudio.Anim.applyPreset(name, target)

// Timeline
PixiStudio.Timeline.playback.play() / pause() / setFrame(f) / setFps(n)
PixiStudio.Timeline.keys.addKey(channel) / deleteSelected() / copy() / paste()

// Inspector
PixiStudio.Inspector.bind(object3D) / refresh()

// Exporter
PixiStudio.Exporter.exportGLB() / exportOBJ() / exportSTL() / exportImage(fmt, res)

// AI
PixiStudio.AI.Tripo.connect(endpoint, apiKey)
PixiStudio.AI.Tripo.textTo3D({prompt, negative, style, quality, ...})   // trung thực khi chưa connect
PixiStudio.AI.Tripo.imageTo3D({file, views})

// Performance
PixiStudio.Perf.start() / snapshot() / history
```

---

## 7. Lộ trình phát triển theo Phase

Chi tiết checklist đầy đủ nằm ở [`docs/PHASES.md`](docs/PHASES.md). Tóm tắt:

| Phase | Nội dung | Trạng thái |
|---|---|---|
| **Phase 0** | Khởi tạo dự án, README, cấu trúc thư mục, server.bat | ✅ Hoàn thành |
| **Phase 1** | Design tokens + CSS layout workspace + responsive 6 breakpoint | ✅ Hoàn thành |
| **Phase 2** | index.html markup toàn bộ UI theo ảnh tham chiếu | ✅ Hoàn thành |
| **Phase 3** | Core: EventBus, State, Storage, History, Bootstrap | ✅ Hoàn thành |
| **Phase 4** | Renderer: Three WebGL + PixiJS overlay + manager | ✅ Hoàn thành |
| **Phase 5** | Viewport: camera orbit, 9 view mode, quad view, grid, lighting, gizmo, picking | ✅ Hoàn thành |
| **Phase 6** | Models: GLB loader + normalize + stats + chibi procedural fallback | ✅ Hoàn thành |
| **Phase 7** | Assets: library + thumbnail 3D thật + import pipeline + drag&drop | ✅ Hoàn thành |
| **Phase 8** | UI runtime: topbar, toolbar, panels, notifications, modals, shortcuts | ✅ Hoàn thành |
| **Phase 9** | Inspector bind thật + Scene hierarchy CRUD | ✅ Hoàn thành |
| **Phase 10** | Timeline: keyframe thật, playback thật, graph editor | ✅ Hoàn thành |
| **Phase 11** | Rigging: skeleton preset + auto rig + visual + bone editor | ✅ Hoàn thành |
| **Phase 12** | Animation: mixer GLB + 16 preset procedural | ✅ Hoàn thành |
| **Phase 13** | Material/Texture: 8 shader, PBR params, texture slots | ✅ Hoàn thành |
| **Phase 14** | Exporter: GLB/OBJ/STL/ảnh/JSON/WebM + render preset | ✅ Hoàn thành |
| **Phase 15** | AI: Tripo adapter + panel + queue trung thực + local manager | ✅ Hoàn thành |
| **Phase 16** | Performance monitor + Game Ready build manifest | ✅ Hoàn thành |
| **Phase 17** | Kiểm thử tổng hợp, node --check toàn bộ JS | ✅ Hoàn thành |
| **Phase 18+** | Kết nối backend AI thật, physics engine đầy đủ, GIF encoder, LOD decimate | 🔜 v5.1 |

---

## 8. Responsive — Hỗ trợ mọi kích cỡ màn hình

Layout dùng CSS Grid với biến `--left-w / --right-w / --bottom-h` (kéo resizer đổi trực tiếp). Breakpoints trong `css/responsive.css`:

| Khoảng màn hình | Hành vi |
|---|---|
| **≥ 2560px (2K/4K)** | Bung full: toolbar 72px, library 340px, inspector 360px, viewport max, font tăng nhẹ |
| **1600–2559px (Desktop lớn)** | Bố cục chuẩn ảnh tham chiếu: 64 / 300 / 320 px |
| **1280–1599px (Laptop)** | Library 260px, Inspector 288px, timeline 200px |
| **1024–1279px (Laptop nhỏ)** | Library 220px, Inspector 264px, bottom row gộp 2 cột |
| **768–1023px (Tablet)** | Library + Inspector chuyển thành **drawer overlay** (nút toggle), toolbar giữ icon, timeline 160px |
| **480–767px (Mobile lớn)** | Top nav cuộn ngang, viewport full-height, panel drawer full-width, bottom chỉ còn timeline + playback |
| **< 480px (Mobile nhỏ)** | Compact mode: ẩn label, grid asset 2 cột, gợi ý xoay ngang; mọi điều khiển vẫn touch được (pointer events) |

Touch support: orbit 1 ngón, pan 2 ngón, pinch-zoom, tap = select, long-press = context menu.

---

## 9. Giao diện — Bố cục chuẩn theo ảnh tham chiếu

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR  [◆PixiJS] Tripo3D.AI Studio (Pro)  v5.0   Studio Model Rig ...    │
│                                    [Local ▾] [Save] [Export] [Upgrade] □ × │
├──┬──────────────────┬────────────────────────────────────────┬─────────────┤
│T │  ASSET LIBRARY   │            3D VIEWPORT                 │  INSPECTOR  │
│o │  search + chips  │  [Perspective ▾][Lit ▾]    ◇ axis gizmo│  ┌─────────┐│
│o │  ┌────┬────┬───┐ │  ┌────────┬────────┐   TRIPO AI CARD  │  │ Model   ││
│o │  │chibi│... │...│ │  │ Front  │ Right  │   ✓ Image to 3D  │  │ Transform││
│o │  └────┴────┴───┘ │  ├────────┼────────┤   ✓ Text to 3D   │  │ Material ││
│l │  [+ Import GLB]  │  │ Left   │ Back   │   [✦ Generate]   │  │ Animation││
│  │  Model Tools 4x2 │  └────────┴────────┘                  │  │ Physics  ││
│  │                  │  timeline tabs → 30FPS  [+Add Key]    │  └─────────┘│
├──┴──────────────────┴────────────────────────────────────────┴─────────────┤
│ TIMELINE  Hero_001 ●Position ●Rotation ●Scale  ▷ 0/120 │Render&Export│Game│
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Phím tắt (Keyboard Shortcuts)

| Phím | Chức năng |
|---|---|
| `W` / `E` / `R` | Gizmo Move / Rotate / Scale |
| `Q` | Tắt gizmo (select only) |
| `F` | Focus vào object đang chọn |
| `Space` | Play/Pause timeline |
| `1`…`8` | Perspective / Quad / Front / Back / Left / Right / Top / Bottom |
| `G` | Bật/tắt lưới |
| `X` | Bật/tắt wireframe |
| `Tab` | Thu gọn/mở left panel |
| `Ctrl+S` | Save project |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+D` | Duplicate object đang chọn |
| `Delete` | Xoá object đang chọn |
| `Esc` | Đóng modal / bỏ chọn |
| `K` | Thêm keyframe tại frame hiện tại |

---

## 11. Tích hợp backend Tripo3D AI sau này

Adapter đã để sẵn REST thật theo chuẩn [Tripo OpenAPI v2](https://platform.tripo3d.ai):

```js
// js/ai/tripo-adapter.js
PixiStudio.AI.Tripo.connect(
  'https://api.tripo3d.ai/v2/openapi',   // endpoint
  'tsk_YOUR_API_KEY'                     // API key (lưu localStorage, không hardcode)
);

// Sau đó:
await PixiStudio.AI.Tripo.textTo3D({
  prompt: 'chibi wuxia hero, stylized 3D, game ready',
  negative_prompt: 'blurry, low poly',
  quality: 'standard',        // 'draft' | 'standard'
  texture_quality: 'standard',
  format: 'glb'
});
// → POST {endpoint}/task/create  → poll GET {endpoint}/task/{task_id}
//   → tải output.url (pbr_model) →PixiStudio.Models.loadURL(blobUrl)
```

**Chưa nhập key**: nút Generate và mọi tool AI hiển thị badge `Not connected` + queue item trạng thái `blocked — waiting for backend`. Không có bước nào tự tạo model giả.

**Backend local (tùy chọn)**: adapter hỗ trợ `PixiStudio.AI.Tripo.connect('http://localhost:7860', 'local')` để nối sang TripoSR / Stable-Fast-3D / Hunyuan3D tự host — cùng 1 giao diện.

---

## 12. Giới hạn thực tế của Prototype (Trạng thái trung thực)

Đúng yêu cầu mục 13 của Master Prompt — **tính năng chưa có backend/model thật sẽ báo trạng thái rõ ràng**:

| Tính năng | Trạng thái hiện tại |
|---|---|
| Tripo Text/Image-to-3D | ⏸ `Not connected` — cần API key / backend (adapter sẵn sàng) |
| AI Retopology / UV / Repair / Upscale | ⏸ Cần backend AI — nút hiển thị trạng thái, không giả lập |
| FBX import | ⏸ Cần fflate + FBXLoader runtime — đang dùng pipeline chuyển đổi ngoài |
| GIF / MP4 export | ⏸ Cần gif.js / ffmpeg.wasm — **WebM đã export thật** qua MediaRecorder |
| Draco/Meshopt nén TRONG TRÌNH DUYỆT | ⏸ Encoder là WASM nặng — dùng nén meshopt qua **server local** (mục 14.4) |
| LOD decimate thực | ⏸ Cần thư viện simplify — hiện tạo khung LOD + cấu hình distance |
| Weight painting / skin binding | ⏸ Cần skinned model + paint tool — visual skeleton + auto-rig hoạt động thật |
| Physics engine đầy đủ | ⏸ Mini gravity sim thật; engine đầy đủ (Rapier/Cannon) ở v5.1 |
| Window controls (minimize…) | ⏸ Chỉ hoạt động khi đóng gói Electron/Tauri — web hiển thị thông báo |

Mọi trạng thái trên đều hiện qua **toast + badge + tooltip** — người dùng luôn biết chính xác cái gì thật, cái gì chưa.

---

## 13. Lộ trình tương lai — Roadmap v5.1+

- [ ] Kết nối Tripo3D API thật (đã có adapter — chỉ cần key).
- [ ] TripoSR local runtime (WebGPU) — text/image → 3D trong máy.
- [ ] Rapier3D physics (WASM) thay mini-sim.
- [ ] gif.js + ffmpeg.wasm cho GIF/MP4 export.
- [ ] FBXLoader đầy đủ (fflate) + Meshopt/Draco decoder cho GLB nén.
- [ ] SkinnedMesh skin binding + weight painting canvas.
- [ ] Animation Blend Tree + State Machine visual editor.
- [ ] Multiplayer collab (CRDT) cho scene.
- [ ] PixiJS Game Runtime: đóng gói scene → bundle game 2D/3D hybrid chạy độc lập.

---

## 14. SAVE CENTER — Lưu & tối ưu file đa định dạng

Mở qua **nút Export (topbar)** · **phím `Ctrl+Shift+S`** · hoặc panel trái **Export**. `Ctrl+S` = lưu nhanh preset cuối.

### 14.1 — 16 định dạng xuất

| Định dạng | Trạng thái | Ghi chú |
|---|---|---|
| **GLB — Tối ưu** | ✅ thật | Weld + quantize + texture WebP + meshopt server — giảm mạnh nhất |
| **GLB — Full Quality** | ✅ thật | GLTFExporter gốc, giữ nguyên chi tiết |
| **GLTF (JSON)** | ✅ thật | Dạng text dễ inspect |
| **OBJ** / **STL** | ✅ thật | Universal / 3D-print |
| **PLY (ASCII)** | ✅ thật | Tự viết — point/mesh scan |
| **JSON Geometry** | ✅ thật | Đỉnh/UV/index thô cho engine riêng |
| **PNG / JPG / WebP Render** | ✅ thật | 1920×1080 (đổi preset độ phân giải ở panel Render) |
| **Spritesheet 8 góc** | ✅ thật | 8 hướng quay 256px → PNG 4×2, dùng ngay cho game 2D |
| **Thumbnail** | ✅ thật | 256×256 |
| **Video WebM** | ✅ thật | MediaRecorder ghi 5s viewport |
| **ZIP Bundle** | ✅ thật | model.glb (meshopt) + preview.png + manifest.json + README.txt |
| **Project JSON** | ✅ thật | Toàn bộ scene + timeline + settings |
| FBX / GIF / MP4 | ⏸ v5.1 | Cần converter/encoder ngoài — hiển thị trung thực |

### 14.2 — 2 CHẾ ĐỘ TƯƠNG THÍCH + 7 Preset (1 click)

⚠️ **Bài học thực tế (v5.0.2)**: file GLB có `EXT_meshopt_compression` trong `extensionsRequired` **bị meshy.ai và studio.tripo3d.ai TỪ CHỐI** (các dịch vụ này không có MeshoptDecoder). Vì vậy Save Center chia 2 chế độ đích:

| Chế độ | Geometry | Texture | Đọc được bởi |
|---|---|---|---|
| ✅ **UNIVERSAL** (mặc định) | f32 thuần, **0 extension required** | JPEG/PNG spec core (alpha-aware) | **meshy.ai ✓ · tripo3d.ai ✓** · Blender · Sketchfab · Unity glTFast · Babylon · mọi loader |
| 🌐 **Web three.js** | quantize + meshopt nén | WebP | Chỉ app có MeshoptDecoder (three.js) — file nhỏ nhất |

| Preset | Target | Điều gì xảy ra |
|---|---|---|
| 💎 **High Quality** ⭐ | web | **GIỮ NGUYÊN chất lượng**: không weld/quantize, texture giữ 4096 chỉ nén WebP q0.95 + meshopt lossless → **−35% KHÔNG VỠ HÌNH** |
| 🪓 **Decimated** ⭐ | universal | **GIẢM TRIANGLES thật 50%** (MeshoptSimplifier giữ UV seams + shape, err 0.00009) + texture 2048 JPEG q0.95 — nhẹ mà không vỡ hình |
| 🤖 **AI Upload** | universal | Không vỡ hình, texture 2048 JPEG q0.95 — an toàn Meshy/Tripo |
| 🎮 **Game Ready** | universal | Weld exact + texture 1024 — cân bằng |
| 🌐 **Web Preview** | web | Quantize + meshopt + WebP 512 — nhỏ nhất (chấp nhận giảm chi tiết) |
| 💎 **Full Original** | — | GLBWriter gốc — 100% chất lượng, không nén (25MB) |
| 🖨️ **3D Print** / 🕹️ **Spritesheet** / 💾 **Project** | — | STL / 8 góc / workspace |

**🪓 Giảm triangles thêm tuỳ ý**: slider **Giảm triangles: Off/25%/50%/75%** trong Save
Center — chạy qua server `/api/meshopt-simplify` (MeshoptSimplifier giữ UV seams +
LockBorder), compact verts tự động, index u16 khi đủ nhỏ. Simplify giữ SHAPE — chất
lượng ảnh không vỡ, chỉ giảm số tam giác.

> 💡 **Vì sao từng bị vỡ hình?** Preset cũ resize texture 4096→512 (mất 99% chi tiết) +
> quantize normals int8 (banding bóng đổ) + weld mạnh (rách mesh). High Quality loại bỏ cả 3 —
> chỉ giữ nén không mất: meshopt lossless (geometry) + re-encode chất lượng cao (texture).

**Verify 2 chiều**: universal → load lại bằng GLTFLoader **THUẦN KHÔNG decoder** (mô phỏng đúng Meshy/Tripo); web → load với MeshoptDecoder. Toast ghi rõ loader nào đã dùng.

### 14.2b — Định dạng DCE/DCC (Blender/Maya)

| Định dạng | Trạng thái | Ghi chú |
|---|---|---|
| **DAE Collada + Textures (ZIP)** | ✅ thật | XML 1.4.1 tự viết + texture PNG — Blender/Maya/Unity import chuẩn |
| **FBX ASCII 7.4** | ✅ thật | Maya/Autodesk/MotionBuilder đọc. ⚠ Blender chỉ đọc FBX binary → dùng DAE/GLB |
| **GLTF Source Pack (ZIP)** | ✅ thật | GLTF JSON embed — nguồn pipeline |
| **BLEND — Blender Import Kit (ZIP)** | ✅ thật | ZIP: model.glb + texture PNG + **import_to_blender.py** (script bpy tạo mesh+UV+material texture trực tiếp trong Blender → Save As .blend). Cách nhanh: import GLB trực tiếp |

### 14.3 — Pipeline giảm dung lượng THẬT (đã verify số liệu trên chính `kiemhiep.glb`)

```
GLBWriter.write(model, options)
  ① Weld vertices        — hash pos/nor/uv → gộp đỉnh trùng
  ② Quantize NORMAL → int8 normalized   (12B → 3B/đỉnh, KHR_mesh_quantization)
  ③ Quantize UV     → uint16 normalized (8B  → 4B/đỉnh)
  ④ Indices u32 → u16 khi ≤ 65.535 đỉnh (4B → 2B/index)
  ⑤ Texture: resize (2048/1024/512/256) + re-encode WebP/JPEG/PNG qua canvas
  ⑥ Meshopt server encode (POST /api/meshopt-encode) — nén geometry ~2-3x thêm
  ⑦ Verify-after-save — tự load lại file bằng GLTFLoader + MeshoptDecoder
     → toast "Verify ✓ — 468,622 tris khớp"
```

**Kết quả đo được trên model mẫu (sau v5.0.2 — đã fix count accessor NORMAL + 2 target):**

```
File gốc (đã làm sạch)            : 10.94 MB
🤖 AI Upload (universal, tex 2048) : 14.04 MB — f32 geometry + JPEG — Meshy/Tripo ✓
🎮 Game Ready (universal, tex 1024): ~12 MB universal safe
🌐 Web Preview (web, meshopt+WebP) :  2.85 MB — giảm 74% — Verify ✓ (three + decoder)
ZIP Bundle (web + preview)         :  5.40 MB — giảm 53%
Texture 4096² → 512² WebP          : 8 MB → 54 KB (−99.3%)
```

> Lưu ý: universal geometry f32 là bắt buộc để dịch vụ AI đọc được — file universal
> có thể lớn hơn source đã-meshopt. Đó là đánh đổi trung thực được ghi trong report.

Sau mỗi lần lưu mở **Compression Report**: trước/sau theo bytes, verts, tris, từng texture, meshopt BẬT/TẮT.

### 14.4 — Meshopt Server API

`server.js` (Node thuần) expose 2 endpoint — bật tự động khi cài `npm install meshoptimizer`:

```
GET  /api/meshopt-ping     → { ok: true, encoder: true }
POST /api/meshopt-encode   → { jobs: [{ data(b64), count, stride, mode }] }
                           ← { ok, results: [{ data(b64 nén) }] }
```

Chạy qua `file://` hoặc chưa cài package → pipeline tự fallback GLB phẳng (tùy chọn vẫn ghi rõ trạng thái trong report — không giả lập).

### 14.5 — Tính năng hỗ trợ lưu khác

- **Save History** (20 mục, localStorage): tên file, định dạng, dung lượng, % giảm, thời gian.
- **Texture Audit**: liệt kê texture của model (slot, kích thước, ~bytes) + tổng — gợi ý nén.
- **Batch export ALL models** → mỗi model 1 GLB tối ưu, overlay tiến độ.
- **Estimate realtime**: ước tính dung lượng geometry thay đổi theo từng toggle.
- **Auto-rotation autosave**: 5 slot vòng trong localStorage (slot_1…slot_5).
- **Filename template**: `{model}_{preset}_{HHMMSS}` + sanitize ký tự an toàn.
- **ZIP Bundle**: model + textures + manifest runtime + README hướng dẫn load.
- **Phím tắt**: `Ctrl+S` lưu nhanh preset cuối · `Ctrl+Shift+S` hộp thoại lưu.

---

## 15. RIG AUTO GEN + ANIMATION AUTO GEN (v5.1 preview)

Ngoài Auto Rig (visual tĩnh), Studio giờ có **2 hệ sinh tự động nâng cao**:

### ⚡ Rig Auto Gen — bone tree ĐỘNG
- Sinh **THREE.Bone hierarchy thật 23 bones** (Root→Hips→Spine→Chest→Neck→Head → 2 tay → 2 chân) từ bounding box model.
- Tên chuẩn **Mixamo** (`mixamorig:Hips`…) hoặc Studio — retarget sẵn cho animation外面.
- Joint sphere + octahedron gắn **trong bone tree** → animate bone = visual di chuyển thật.
- `THREE.SkeletonHelper` preview + `AnimationMixer` gắn trực tiếp rootBone.
- API: `PixiStudio.RigAutoGen.generate(model, 'Mixamo Compatible')`.

### 🎬 Animation Auto Gen — 6 clips tự sinh trên bones
- `Idle · Walk · Run · Attack · Combo · Dodge` — quaternion/vector tracks target từng bone.
- Crossfade mixer + speed slider + play/pause preview.
- API: `PixiStudio.AnimAutoGen.play('Attack')` — đã verify RightHand di chuyển 1.427u khi play.

---

## 15b. MESHY FBX RIG IMPORT — Running → Idle/Attack (v5.0.5)

Đọc FBX Mixamo thật từ Meshy (FBXLoader + fflate) — **học skeleton + Running data** rồi
sinh animation mới theo đúng pipeline Meshy workspace:

```
Meshy_AI_kiem_hiep_…animated_mixamo_Running.fbx   (46 bones, Running 0.63s × 141 tracks)
Meshy_AI_kiem_hiep_…character_mixamo.fbx          (rig không animation)
        │ FBXLoader parse
        ▼
Idle (3.2s, 48 tracks)    ← rest pose + breathing sway ±2-4°/bone + hips bob
Attack (0.85s, 48 tracks) ← frame deviation-max → wind-up → strike ×1.35 → rest
Running (gốc)             — cả 3 clips crossfade mixer, verified bone di chuyển thật
```

UI: **Animation Studio → 🎞 Meshy FBX Rig** — auto-detect qua `/api/fbx-list`,
play từng clip, Preview viewport, **Clips JSON export** (retarget bone-name cho model khác).

---

## 15c. AUTO-SKINNING — mesh CỬ ĐỘNG theo bones (v5.0.7)

**Vấn đề**: model rigid (Tripo/Meshy GLB) sau Auto Rig Gen — bones animate nhưng
mesh đứng im vì không có skin binding. **Fix như Meshy**: `RigAutoGen.bindSkin()`
- Mỗi rigid mesh → **THREE.SkinnedMesh** (cùng geometry/material)
- **skinIndex + skinWeight** tự tính bằng bone-segment distance (2 bones gần nhất, inverse falloff)
- Vertices bake world-space + bind identity → bones animate → **mesh deforms thật**
- Camera mặc định **Perspective** (bỏ Quad default) · nút 🦴 **Rig AI Gen** + 🎬
  **Animation AI Gen** giống Meshy workspace trong Animation panel

---

## 16. GAME DEMO — WUXIAMMORPG.html (PixiJS v8)

**`WUXIAMMORPG.html`** — game MMORPG isometric hoàn chỉnh chạy độc lập (mở file hoặc qua server):

> ⚔ **Quan Ải Long Ngâm — Trường Bạch**: map tuyết Trung Hoa cổ, đền 2 tầng mái ngói xanh,
> party 3 nhân vật (kiếm/thương/song đao), 4 wave địch + boss Thor, 5 skill hiệu ứng
> (Kim Hoàn Trận · Long Kiếm · Viêm Đao · Long Ngâm · Né thân), quest tracker, minimap,
> loot vàng, snowfall, camera shake, WebAudio SFX.

- PixiJS v8.6.6 CDN · thuần JS · không build tool · HUD HTML/CSS overlay.
- Điều khiển: **WASD** di chuyển · **Chuột trái** đánh · **Q/E/R/F** skills · **Space** né · **Lăn chuột** zoom.
- Xem chi tiết kỹ thuật trong `docs/PHASES.md` Phase 22.

---

## 17. Giấy phép

- **Code dự án**: MIT — tự do dùng/sửa/thương mại hoá.
- **three.js**: MIT © three.js authors. **pixi.js**: MIT © PixiJS contributors.
- **Model `kiemhiep.glb`**: thuộc người dùng cung cấp — trách nhiệm bản quyền model nằm với chủ sở hữu file gốc.

---

*PixiJS Studio × Tripo3D AI Studio v5.0 — Built with ❤ for 3D game creators. Prototype theo Master Prompt v5.0, layout chuẩn theo ảnh tham chiếu Dashboard.*
