# PHASES.md — Lộ trình phát triển PixiJS Studio × Tripo3D AI Studio v5.0

> Checklist chi tiết từng phase. Tick `[x]` = hoàn thành và đã kiểm tra.

---

## Phase 0 — Khởi tạo dự án ✅

- [x] `README.md` — tài liệu tổng thể, kiến trúc, module API, responsive spec
- [x] Cấu trúc thư mục `css/ js/ assets/ docs/`
- [x] Copy `kiem hiep.glb` → `assets/models/kiemhiep.glb` (model mẫu chuẩn)
- [x] `server.bat` — server local 1 click (Python/Node auto-detect)

## Phase 1 — Design System & Layout CSS ✅

- [x] `css/main.css` — design tokens: #111116/#1B1B24/#252530/#343443/#713BFF/#27BFFF/#42DF75/#FFC928
- [x] Reset, typography, scrollbar custom, focus ring
- [x] `css/layout.css` — grid workspace 6 vùng (topbar/toolbar/left/viewport/right/bottom)
- [x] `css/components.css` — button, input, select, tabs, chip, toggle, tooltip, context menu
- [x] `css/panels.css` — asset library, inspector, Tripo AI card, modal, toast
- [x] `css/timeline.css` — ruler, track, keyframe diamond, playhead, graph
- [x] `css/responsive.css` — 6 breakpoint (≥2560 / 1600 / 1280 / 1024 / 768 / 480) + touch

## Phase 2 — UI Markup (index.html) ✅

- [x] Topbar: logo PixiJS + Tripo3D.AI (Pro) + v5.0 + 10 workspace tab + Local/Save/Export/Upgrade + window controls
- [x] Left toolbar icon rail: Assets/Model/Rig/Animation/Material/Scene/Render/Export/AI Tools
- [x] Asset Library: search, filter chips, grid 9 chibi, Import button, Model Tools 8 nút
- [x] Viewport: view dropdown, lit dropdown, tool strip, axis gizmo, quad labels, Tripo AI card, perf HUD
- [x] Right panel: Inspector/Scene tabs — Model Info, Transform, Material, Animation, Physics
- [x] Bottom: Timeline (4 tab) + playback controls + Render & Export + Game Ready
- [x] Hidden layers: file input, modal root, toast root, context menu, loading overlay

## Phase 3 — Core Modules ✅

- [x] `core/utils.js` — `$`, `$$`, `el()`, uid, clamp, formatBytes, download, escapeHtml
- [x] `core/events.js` — EventBus on/off/once/emit
- [x] `core/state.js` — selection, view mode, gizmo mode, settings, workspace
- [x] `core/storage.js` — autosave 60s, project slots, prompt history
- [x] `core/history.js` — undo/redo snapshot transform
- [x] `core/app.js` — bootstrap theo thứ tự phụ thuộc + render loop + wiring events

## Phase 4 — Renderer ✅

- [x] `three-renderer.js` — WebGL, antialias, shadow PCFSoft, ACES tone mapping, alpha background
- [x] `pixi-renderer.js` — PixiJS v7 overlay particles + select sparkle (chạy thật)
- [x] `renderer-manager.js` — resize, scissor quad dispatch, renderer.info bridge

## Phase 5 — Viewport ✅

- [x] `camera.js` — OrbitCam: orbit/pan/zoom/damping/focus, 8 hướng view, ortho cameras
- [x] `controls.js` — pointer/touch (1 ngón orbit, 2 ngón pan/pinch), click select, hover
- [x] `grid.js` — GridHelper + trục XYZ màu + ground glow ring tím
- [x] `lighting.js` — key/fill/rim/hemisphere, shadow ground
- [x] `gizmo.js` — TransformControls (W/E/R) + axis triad 3D góc phải (quay theo camera)
- [x] `viewport.js` — 9 view mode + quad scissor render + picking + screenshot + stats

## Phase 6 — Models ✅

- [x] `model-manager.js` — loadDefault(kiemhiep.glb) → fallback chibi + notification trung thực
- [x] Normalize: height≈2.0, đáy chạm grid, center X/Z
- [x] Stats thật: faces/vertices/triangles/meshes/materials/textures/fileSize
- [x] `sample-model.js` — chibi võ lâm procedural: đầu to/thân nhỏ, robe, khăn đỏ, tóc búi, kiếm lưng

## Phase 7 — Assets ✅

- [x] `asset-library.js` — 9 variant chibi + props/env/fx, thumbnail render 3D offscreen thật
- [x] Search realtime + chip lọc theo category
- [x] `importers.js` — GLB/GLTF/OBJ/STL/ảnh/audio thật + FBX trung thực + drag&drop
- [x] Model Tools: Auto Rig, Auto Animate, Optimize (merge thật), Texture Bake, Retopology(⏸), LOD(⏸ decimate), Collider (wireframe thật), UV (⏸ unwrap sâu)

## Phase 8 — UI Runtime ✅

- [x] `topbar.js` — workspace tabs đổi panel trái, Save/Export/Upgrade actions, window controls trung thực
- [x] `toolbar.js` — icon rail active state + tooltip + flyout submenu
- [x] `panels.js` — resizer kéo (left/right/bottom), collapse Tab, context menu chuột phải
- [x] `notifications.js` — toast 4 loại + loading overlay progress
- [x] `modals.js` — Settings, Project Manager, About, Export dialog
- [x] `shortcuts.js` — 16 phím tắt toàn cục

## Phase 9 — Inspector & Scene ✅

- [x] `inspector.js` — bind selection thật: transform inputs ↕ cập nhật 2 chiều, material, animation, physics
- [x] Model info stats từ ModelManager
- [x] Scene tab: hierarchy tree thật, CRUD, re-parent drag&drop, lock/hide

## Phase 10 — Timeline ✅

- [x] `keyframes.js` — track Position/Rotation/Scale/Bone/Facial/Camera, add/del/copy/paste, linear interp
- [x] `playback.js` — fps 12/24/30/60, loop, frame step, playhead sync
- [x] `timeline.js` — ruler canvas, diamond keyframe kéo được, scrub, zoom, graph editor canvas thật

## Phase 11 — Rigging ✅

- [x] `skeleton.js` — Bone class + 6 preset (Mixamo Compatible…Custom)
- [x] `rig-manager.js` — Auto Rig từ bbox thật, visual bone octahedron + joint, bone picking
- [x] `bone-editor.js` — bone list, rename, mirror (trái↔phải)

## Phase 12 — Animation ✅

- [x] `animation-manager.js` — mixer, clip list từ GLB thật, play/pause/stop/speed/loop/crossfade
- [x] `presets.js` — 16 preset procedural clip thật cho sample rig + retarget theo tên bone

## Phase 13 — Material & Texture ✅

- [x] `material-manager.js` — 8 loại shader, PBR params thật, apply selection/toàn model
- [x] `texture-manager.js` — slots BaseColor/Normal/Roughness/AO/Emission/Height, gán texture import

## Phase 14 — Exporter ✅

- [x] GLB/GLTF thật (GLTFExporter binary), OBJ, STL
- [x] PNG/JPG/WebP screenshot thật + render preset 720p→4K offscreen
- [x] Project JSON save/load thật
- [x] WebM video thật (MediaRecorder) — GIF/MP4 trung thực ⏸

## Phase 15 — AI Module ✅

- [x] `tripo-adapter.js` — REST chuẩn Tripo OpenAPI, connect(endpoint, key), queue, polling
- [x] Chưa có key ⇒ trạng thái `Not connected` rõ ràng, không giả lập kết quả
- [x] `ai-panel.js` — Text-to-3D, Image-to-3D, local model manager, VRAM/RAM monitor, prompt history

## Phase 16 — Performance & Game Ready ✅

- [x] `monitor.js` — FPS thật, draw calls, tris, geometries, textures từ renderer.info + graph canvas
- [x] Cảnh báo FPS < 30 (warning) / < 15 (danger)
- [x] Game Ready: build manifest JSON (assets + runtime config PixiJS)

## Phase 17 — Kiểm thử tổng hợp ✅

- [x] `node --check` toàn bộ 40+ file JS — 0 lỗi cú pháp
- [x] Boot test qua server local — mọi module init không crash
- [x] Kiểm tra load kiemhiep.glb + fallback chibi

## Phase 18 — Làm sạch kiemhiep.glb (v5.0.1) ✅

- [x] `tools/inspect-glb.js` — mổ xẻ GLB: chunks, nodes, accessors, extensions, histogram cluster
- [x] `tools/clean-kiemhiep.js` — pipeline Node: decode meshopt WASM → phát hiện 4 cụm theo trục Z
      (histogram peak/minima) → xác minh trùng lặp (height 100% khớp) → giữ 1 xoá 3 →
      recenter → re-encode meshopt → round-trip position **lossless 0.00e+0**
- [x] Kết quả: **17.86 MB → 10.94 MB (−38.8%)** — 991.839→244.865 verts, 1.897.430→468.622 tris
- [x] Backup tự động `kiemhiep-full-backup.glb` + verify parse ngược (maxIdx < verts ✓)
- [x] Load lại trong app: Hero_001 — 468.622 tris — FPS 144 (gấp ~3 lần trước)

## Phase 19 — SAVE CENTER: lưu & tối ưu file đa định dạng (v5.0.1) ✅

- [x] `exporter/glb-writer.js` — GLB writer riêng: weld vertices, quantize NORMAL int8 /
      UV uint16 (KHR_mesh_quantization), indices u16 khi ≤65.535 đỉnh, texture resize +
      re-encode WebP/JPEG/PNG qua canvas, fallback PNG 1×1 khi texture tainted
- [x] `exporter/zip-writer.js` — ZIP STORE thuần JS (CRC32 + local headers + central dir)
- [x] `exporter/save-manager.js` — Save Center: **16 định dạng** (14 thật + FBX/GIF/MP4 ⏸),
      **6 presets** 1-click, texture audit, save history (localStorage 20 mục), filename
      template `{model}_{preset}_{HHMMSS}`, batch export all models, autosave rotation 5 slot
- [x] **Meshopt server API** trong `server.js`: `/api/meshopt-ping`, `/api/meshopt-encode`
      (Node MeshoptEncoder WASM) — browser gửi buffer → nhận bytes nén → rebuild
      GLB với EXT_meshopt_compression; fallback phẳng an toàn khi không có server
- [x] **Verify-after-save**: tự load file mới bằng GLTFLoader + MeshoptDecoder →
      toast "Verify ✓ — 468,622 tris khớp"
- [x] **Compression Report modal**: bytes trước/sau, % giảm, breakdown từng texture, meshopt BẬT/TẮT
- [x] UI: Export panel → Save Center (estimation realtime), topbar Export + Ctrl+S / Ctrl+Shift+S
- [x] Kết quả đo thật: Web Preview **−59%** (4.51MB), Game Ready **−57%** (4.67MB),
      ZIP Bundle **−53%** (5.4MB) — texture 4096²→512² WebP: 8MB → 54KB (−99.3%)

## Phase 20 — Fix tương thích Meshy.ai / Tripo3D.ai (v5.0.2) ✅

- [x] **Bắt lỗi gốc rễ**: GLBWriter ghi accessor NORMAL `count` = số COMPONENTS (734.595)
      thay vì số ĐỈNH (244.865) → mọi loader bên ngoài đọc vượt buffer →
      `Invalid typed array length: 2203785` — chính là lỗi Meshy/Tripo từ chối file
- [x] **2 chế độ tương thích**: `universal` (0 extension required, texture JPEG/PNG spec core)
      vs `web` (meshopt + quantize + WebP — chỉ three.js)
- [x] Texture WebP giờ tuân spec `EXT_texture_webp` (webp + fallback JPEG/PNG, used-KHÔNG-required)
- [x] Alpha-aware: texture có alpha tự dùng PNG thay JPEG
- [x] Verify-after-save nghiêm ngặt: universal load bằng GLTFLoader **THUẦN KHÔNG decoder**
      (mô phỏng đúng hành vi Meshy/Tripo) — PASS 468.622 tris + 3 textures
- [x] Guard meshopt: bật meshopt khi universal → tự bỏ + cảnh báo trung thực
- [x] Preset mới 🤖 **AI Upload** (universal texture 2048) + switch target trên Save Center

## Phase 21 — Rig Auto Gen + Animation Auto Gen (v5.1 preview) ✅

- [x] `js/rigging/rig-auto-gen.js` — sinh **THREE.Bone hierarchy thật** (23 bones) từ
      bounding box: Root→Hips→Spine→Chest→Neck→Head + 2 tay + 2 chân, tên chuẩn
      Mixamo (`mixamorig:`) hoặc Studio — bone tree ĐỘNG (animate được)
- [x] Visual joint sphere + octahedron gắn TRONG bone tree — animate bone = visual chạy
- [x] THREE.SkeletonHelper preview + AnimationMixer gắn rootBone
- [x] `js/animation/anim-auto-gen.js` — 6 clips procedural quaternion/vector tracks:
      Idle · Walk · Run · Attack · Combo · Dodge — crossfade mixer, speed slider
- [x] Verify: RightHand di chuyển 1.427 units khi play Attack — bone animate THẬT
- [x] UI: section ⚡ Auto Rig Gen trong Rig panel + 🎧 Animation Auto Gen trong Animation panel
- [x] App loop update mixer mỗi frame

## Phase 22 — WUXIAMMORPG.html — Quan Ải Long Ngâm (PixiJS v8) ✅

- [x] Single-file game thuần JS + PixiJS v8.23.0 CDN (IIFE build, không build tool)
- [x] Isometric 2.5D: tile 64×32, depth sort zIndex = wx+wy, 7 layers
- [x] Map Trường Bạch: 60×60 tiles tuyết batch-render, đường đá, plaza, mountain backdrop
- [x] Đền Trung Hoa: mái cong 2 tầng xanh đám + tuyết, cột đỏ, 3 cửa, đèn lồng glow động,
      bậc thang, đài hương, bảng hiệu
- [x] Environment dày: 8 nhà gỗ, 30+ thông tuyết, hàng rào, đèn lồng phố, xe đẩy, thùng gỗ,
      sạp hàng, biển gỗ, tượng sư tử đá, 6 NPC (lính gác/thương nhân/dân làng)
- [x] Party 3: Kiếm Khách (player) + Lâm Sương (thương AI) + Tuyết Nhi (song đao AI) —
      follow formation, auto-attack, companion skills
- [x] Enemy AI: patrol → detect → chase → attack → hit → death; 4 wave (sơn tặc → tinh nhuệ → boss Thor)
- [x] Combat: auto attack, target lock (click), combo, crit 20%, damage numbers, knockback,
      hit spark, death poof, hồi sinh party, screen shake
- [x] 5 skills: 💫 Kim Hoàn Trận (golden rings AoE) · 🐉 Long Kiếm (blue dragon thrust) ·
      🔥 Viêm Đao (flame arc) · 🌪 Long Ngâm (ultimate: dragon + shockwave + pillar + flash) · 💨 Né thân
- [x] HUD MMORPG: level/HP/XP/gold/kills, party bars, quest tracker, wave panel, boss bar,
      target frame, skillbar + cooldowns, controls hint, vignette hurt
- [x] MiniMap canvas: temple/party/enemies/NPCs · Snowfall 170 hạt · Loot gold coins hút về player
- [x] WebAudio SFX synth (hit/swing/skill/ult/pickup) · Level-up system
- [x] Fix: TileMap batch 3 fill (3600→3 calls, 6ms), userData PIXI v8, player name, palette tuyết
- [x] Verify browser: boot ✓ · WASD move ✓ · Skill Q/F cast ✓ · Kill + loot +33 vàng ✓ · Wave progress ✓

## Phase 22.1 — Fix chất lượng + formats + UI (v5.0.3) ✅

- [x] **Báo lỗi user: file GLB tối ưu bị VỠ HÌNH** — nguyên nhân: texture 4096→512 (mất
      99% chi tiết) + quantize normals int8 + weld mạnh. Fix:
  - [x] Preset mới 💎 **High Quality**: weld OFF (exact nếu bật), KHÔNG quantize,
        texture GIỮ 4096×4096 chỉ re-encode WebP q0.95 (lossy không nhìn ra) +
        meshopt server lossless → **−35% không vỡ hình (10.94→7.17MB, verified)**
  - [x] Normal map guard: KHÔNG BAO GIỜ JPEG cho normal (chroma subsampling phá normal);
        quality normal ≥0.96; universal → PNG
  - [x] weldMode 3 mức: exact (bit-for-bit) / tight (1e7) / loose (1e5)
  - [x] Mặc định toàn cục: weld OFF, textureMaxSize 0 (giữ nguyên), quality 0.92
- [x] **Thêm formats**: DAE Collada + Textures (ZIP, viết XML 1.4.1 tay — Blender/Maya/Unity),
      FBX ASCII 7.4 (Maya/Autodesk — Blender cần binary, hướng dẫn dùng DAE/GLB),
      GLTF Source Pack ZIP, BLEND → modal hướng dẫn đường dẫn import chuẩn
- [x] deepConvertForExporter: GLTFExporter r128 không đọc Int8 attributes (từ meshopt GLB)
      → clone + convert mọi attribute sang Float32 + bake world matrix
- [x] glb-full đổi sang GLBWriter high-fidelity (ổn định hơn GLTFExporter mesh lớn):
      **25.21 MB** giữ nguyên 100% chất lượng
- [x] Fix Asset Library **không cuộn**: bọc panel-body overflow-y — scrollHeight 1078 vs
      client 490 → thanh kéo hoạt động, chips sticky, mọi card hiển thị
- [x] Verify đo thật: HQ −35% (7.17MB) · GLB Full 25.21MB · FBX 60.6MB · DAE 75.2MB ·
      Texture 4096 giữ nguyên trong report

## Phase 22.2 — Simplify + Tripo tools + BLEND kit + fixes (v5.0.4) ✅

- [x] **Giảm triangles THẬT (giữ chất lượng ảnh)**: `/api/meshopt-simplify` server
      (MeshoptSimplifier.simplifyWithAttributes giữ UV seams — LockBorder) +
      `applySimplifyFromServer` client: parse GLB → simplify → compact verts → u16
      index → Verify: 468,622 → 234,310 tris (−50%, err 0.00009 — shape giữ nguyên)
- [x] Save Center option **🪓 Giảm triangles: Off/25%/50%/75%** + preset 🪓 **Decimated**
- [x] Fix perf: Float32Array view tạo 1 lần (trước: 1.5M views/vertex — block 20s+)
- [x] **Tripo AI bổ sung đủ**: `textureModel` (texture_model) · `upscaleModel`
      (upscale_model) · `rigModel` (rig_model) · `animateModel` (animate_model
      idle/walk/run) — REST thật qua task create + polling, lưu `lastCreatedModelId`
      chain tool. UI: **🧠 AI Model Tools** section trong AI panel
- [x] **BLEND — Blender Import Kit** (thật): ZIP chứa model.glb + texture PNG +
      **import_to_blender.py** (script bpy: from_pydata mesh + UV layer + material
      nodes texture) — chạy trong Blender Scripting → Run → Save As .blend.
      Cách nhanh: Blender File > Import > glTF 2.0 (GLB kèm theo)
- [x] Fix **Auto Rig Gen / Animation Auto Gen "không hoạt động"**:
      `anim-auto-gen.js` thiếu `const U = PixiStudio.Utils` → crash khi mở panel;
      renderPanel chưa được gọi khi mở Rig/Animation page → wire vào Toolbar
- [x] Fix model loader: `/api/models` auto-detect GLB trong assets/models (user đổi
      thư mục không lo gãy) — ưu tiên kiemhiep → tripo_ → Meshy_ → mtime mới nhất

## Phase 22.3 — Meshy FBX Rig Import + Idle/Attack generation (v5.0.5) ✅

- [x] Đọc file FBX Meshy thật: `Meshy_AI_kiem_hiep_…animated_mixamo_Running.fbx` +
      `…character_mixamo.fbx` qua **FBXLoader r128 + fflate** (CDN)
- [x] Trích skeleton: **46 bones Mixamo** (`mixamorigHips`…) + hierarchy tree
- [x] Extract clip **Running** gốc: 0.63s × **141 quaternion/position tracks**
- [x] **Sinh Idle từ Running** (procedural retarget): rest pose từng bone + breathing
      sway ±2-4° theo AMPLITUDE table, hips bob, 3.2s loop — **48 tracks**
- [x] **Sinh Attack từ Running**: tìm frame RightArm deviation max → wind-up (flip Y 55%)
      → strike (boost ×1.35) → rest, hips lunge, 0.85s — **48 tracks**
- [x] Mixer preview + crossfade — **verified đo RightHand world Y**:
      Idle range 0.598 · Running 13.78 · Attack 21.17 — cả 3 clips DI ĐỘNG THẬT
- [x] UI: 🎞 Meshy FBX Rig section trong Animation panel — auto-detect qua
      `/api/fbx-list`, Preview viewport, Clips JSON export (retarget cho model khác)
- [x] Wire app loop `FbxRig.update(dt)` + server `/api/fbx-list` recursive search

## Phase 22.4 — Meshy Rigging Studio + Tripo Generate thật + Auto-update (v5.0.6) ✅

- [x] **Fix FBX preview không hiện**: `FbxRig.addToViewport` dùng biến `Engine` không
      tồn tại trong scope → ReferenceError. Sửa: dùng `PixiStudio.Viewport.modelRoot`
      trực tiếp. **Verified: FBX Meshy vào viewport + auto-play Idle**
- [x] **Rigging Studio nav tab (giống Meshy workspace)**: tab "Rigging" mới trong
      topbar + page riêng — card Model preview + dropdown Rigging type (Humanoid
      Mixamo / 23 bones / Quadruped ⏸) + nút **Auto-Rigging** lớn → pipeline:
      FBX Meshy có sẵn rig (46 bones Mixamo) → ✓ complete + Bone Tree + Go to
      Animation. Fallback: backend analyze model hiện tại
- [x] **Tripo Generate chạy THẬT**: nút ✨ Generate → **modal Quick Generate**
      (prompt + negative) → POST REST /task/create → queue + polling. Chưa có key →
      **modal Connect** (endpoint + API key) → lưu localStorage → connect & generate
      ngay. Verified: fail trung thực khi key giả ("Failed to fetch")
- [x] **Auto-update engine**:
      • Tripo: poll /task/{id} mỗi 5s cho task processing → **auto-import GLB
        vào viewport khi success** + progress emit
      • Meshy: quét /api/fbx-list mỗi 20s → phát hiện FBX mới (không phải seed)
        → toast thông báo
      • Toggles trong Settings + localStorage persistence

## Phase 22.5 — AUTO-SKINNING + Perspective default + Meshy buttons (v5.0.7) ✅

- [x] **AUTO-SKINNING thật (fix "animation không cử động")**: nguyên nhân — model
      rigid mesh KHÔNG có skin binding → bones animate nhưng mesh đứng im.
      `RigAutoGen.bindSkin()`: mỗi rigid mesh → **THREE.SkinnedMesh** với
      skinIndex (Uint16 ×4) + skinWeight (Float32 ×4) computed bằng
      **bone-segment distance** (distToSegment từ anchors), vertices bake
      world-space, `skinned.bind(skeleton, identity)` — mesh CỬ ĐỘNG theo
      bones giống Meshy Rigging result
- [x] **Camera mặc định Perspective** (state.js + select + viewport init) — bỏ Quad default
- [x] **2 nút Meshy-style** trong Animation panel: 🦴 **Rig AI Gen** (chuyển
      Rigging tab + autoRig) + 🎬 **Animation AI Gen** (load FBX + play Idle,
      fallback 16 presets) — pipeline giống Meshy workspace
- [x] FbxRig dedupe addToViewport (tránh model trùng khi re-load)

## Phase 22.6 — Material Auto-Update + Animation Fix + IAB Safe Mode (v5.0.8) ✅

- [x] **FIX IAB renderer block "bằng mọi cách"**:
      • Texture Safe Mode: display textures downscale ≤512px (auto sau GLB parse)
        — `originalImage` giữ trong userData → **export vẫn full-res 4096**
      • pixelRatio = 1 (bỏ 2x GPU burden)
      • Kết quả: **FPS 1 → 144** sau fix — boot không block
- [x] **FIX Idle click đơ**: `generate()` RE-USE rig hiện có (chỉ regenerate clips
      thay vì destroy+rebuild toàn bộ) + `bindSkin` gọi SAU khi `current` gán
      (trước gọi trước → rig null → skin không bind → "không cử động")
- [x] **Material auto-update nâng cấp**: scope select (Selection/Toàn model live),
      viewport invalidateShading mỗi param change, panel tự re-render khi selection
      đổi, 6 material presets one-click (Kim loại/Nhựa/Vàng/Gỗ/Đá/Kính)
- [x] tools/verify-v508.js — 21/21 features ✓

## Phase 22.7 — Fix treo app khi chọn Animation Presets + thanh menu workspace (v5.0.9) ✅

- [x] **BÁO LỖI USER: “animation ấn vào play bị đơ khi chọn animation Presets”** — tìm ra
      nguyên nhân gốc bằng bisect thật trong browser (heartbeat ghi localStorage +
      trang test mixer riêng, không dính model 468k tris):
      `presets.js` truyền mảng quaternion **LỒNG NHAU** (`[quat, quat, …]`) vào
      `THREE.QuaternionKeyframeTrack` → `new Float32Array(values)` cho toàn **NaN** với
      `length` = số quaternion (5) → `KeyframeTrack.getValueSize()` =
      `values.length / times.length` = **1** thay vì 4 → vòng lặp
      `QuaternionLinearInterpolant.interpolate_` (`offset += 4` so với `end = offset + 1`)
      **không bao giờ kết thúc** → main thread treo cứng (FPS về 0, tab phải kill)
- [x] Fix: `fitValues()` trong `presets.js` — làm phẳng mảng lồng + ép đúng
      `values.length = times.length × size` (3 vector / 4 quaternion) + loại mọi giá trị
      NaN/Inf → áp cho cả 16 preset
- [x] Cùng lỗi ở `anim-auto-gen.js` (6 clip Auto Gen) → fix tương tự; phát hiện **thêm**
      2 track Hips của `Attack`/`Combo` bị dựng bằng `qTrack` (quaternion) nhưng truyền
      dữ liệu 3 thành phần → NaN, đổi sang `vTrack` (position) đúng ngữ nghĩa
- [x] Guard an toàn `Anim.validateClip()` (`animation-manager.js`): chặn phát nếu track sai
      số lượng giá trị hoặc có NaN — áp cho `Anim.play`, `AnimAutoGen.play`, `FbxRig.play`
      → clip hỏng không thể treo app nữa
- [x] **Thanh menu workspace bị hỏng**: `#workspace-nav` thiếu `display:flex` nên 11 tab xếp
      **DỌC** trong khung topbar 48px (chỉ thấy 1 tab, phần còn lại bị cắt). Fix:
      `display:flex; align-items:center; gap:2px` + `.ws-tab` co lại được
      (`flex:0 1 auto`) và **nhãn dài tự xuống dòng** (`white-space:normal`),
      nav cuộn ngang khi tràn
- [x] Nhãn dài trong dropdown / context menu cũng xuống dòng (`.dd-item`, `.ctx-item`)
      + `max-width` để menu không tràn màn hình
- [x] **Perf HUD sai số liệu**: `renderer.info` bị reset bởi lần vẽ axis-gizmo cuối frame →
      HUD/Perf hiển thị tam giác của gizmo (1.020) thay vì scene thật (50.000).
      Fix: `RendererManager.captureInfo()` gọi ngay sau khi vẽ scene chính
- [x] `tools/verify-anim.js` — test tự động chạy three.js r128 THẬT trong Node:
      16 preset + 6 clip Auto Gen (độ dài track, NaN, chạy mixer 120 update) →
      **22/22 PASS**, mixer 0–5 ms/clip. Chạy: `npm run verify:anim`
- [x] Đo thật trong browser sau fix: click preset 5–15 ms, không treo; FPS 60; chi phí render
      JS 2,49 ms/frame; thanh menu 1 hàng ngang

## Phase 22.8 — EXPORT GLB KÈM ANIMATION (Meshy Animate-style) ✅

- [x] **BÁO LỖI GỐC**: bản `GLTFExporter` examples/js của three r128 có chữ ký
      `parse( input, onDone, options )` — **không có tham số onError**. Mọi lệnh gọi
      `parse(obj, done, err, {binary:true})` trong app bị hiểu sai ⇒ `options.binary` và
      `options.animations` **bị bỏ qua** ⇒ file .glb tải về thực chất là **JSON** và
      **không có animation nào**. Fix: gọi đúng `parse(input, onDone, options)`
      (`exporter.js` + module mới)
- [x] `js/exporter/anim-glb-export.js` — **Export GLB + Animation** (giống Meshy Animate):
  - [x] Tự rig nếu model chưa có rig (`RigAutoGen.generate`) + tự **auto-skin**
        (`bindSkin`) ⇒ model import vào là xuất được ngay, không cần thao tác trước
  - [x] Gom clip từ 3 nguồn: **6 chuyển động đặt sẵn** (Idle/Walk/Run/Attack/Combo/Dodge),
        **3 clip FBX Meshy** (Running/Idle/Attack) và clip có sẵn trong GLB import
  - [x] **Retarget tên bone** tự động (`mixamorigHips` ↔ `Hips`, `Spine1`→`Spine`,
        bỏ `_`/`-`, không phân biệt hoa/thường) + chỉ giữ track khớp bone thật —
        đo thật: Running **63/141 track**, Idle/Attack **22/48 track** khớp rig 23 bone
  - [x] Ẩn mesh visual của bone (octahedron/joint sphere) + SkeletonHelper khi export
        (`onlyVisible: true`) ⇒ file sạch, **0 node rác**
  - [x] Chuyển attribute Int8/Uint16(normalized) → Float32 trước khi ghi (r128 hay sai)
  - [x] **Verify sau khi xuất**: load lại file bằng GLTFLoader THUẦN (không decoder —
        mô phỏng Blender/Unity/Meshy) + phát clip và **đo bone di chuyển thật**
- [x] UI: section **📦 Export GLB + Animation** trong Animation panel — chọn rig preset
      (Studio/Mixamo), tick từng clip (có nhãn nguồn + tỉ lệ retarget), nút export,
      nút “⚡ Rig + Skin + 6 chuyển động”, bảng báo cáo lần xuất gần nhất
- [x] `server.js`: endpoint **POST /api/save-export** → lưu file export vào
      `exports/` của project (ngoài việc trình duyệt tải về)
- [x] `tools/verify-anim-glb.js` — kiểm tra file .glb: header/chunk, animations
      (channel nhắm vào joint thật), skins, JOINTS_0/WEIGHTS_0, node rác,
      extension bắt buộc. Chạy: `node tools/verify-anim-glb.js exports/<file>.glb`
- [x] **Kết quả đo thật** (`exports/kiemhiep_animated_9clips.glb`, 2,37 MB):
      9 clip — Idle 2.6s · Walk 1s · Run 0.7s · Attack 0.8s · Combo 1.4s · Dodge 0.6s ·
      Running(FBX) 0.63s/63ch · Idle(FBX) 3.2s/22ch · Attack(FBX) 0.85s/22ch;
      1 skin 23 joint · 1 skinned mesh có JOINTS_0+WEIGHTS_0 · **0 extension bắt buộc**
      ⇒ Blender/Unity/three.js/Meshy đọc trực tiếp; verify: bone Hips chuyển động 0.024

## Phase 22.9 — Fix rig sai cỡ + skin biến dạng sai + màu texture khi export (v5.0.10) ✅

- [x] **BÁO LỖI USER**: animation như đứng yên · màu không giống `tripo_convert_kiemhiep.glb`
      · rig to hơn nhân vật. Đo thật trong app để tìm nguyên nhân gốc:
- [x] **Rig to gấp 2 lần** — bone/anchor tính theo toạ độ WORLD nhưng lại đặt làm
      position LOCAL trong `__autogen_rig__` là con của model (model chuẩn hoá height≈2)
      ⇒ bị nhân thêm scale 2. Đo được: Hips world = **2.08** trong khi anchor đúng 1.04.
      Fix: bù scale nghịch đảo cho rig group (`root.scale = 1/targetWorldScale`)
      → Hips world = 1.04 ✓, rig khớp đúng cỡ nhân vật
- [x] **Skin biến dạng sai / như đứng yên** — `bindSkin` bake vertex sang WORLD rồi
      `bind(skeleton, identity)`, nhưng SkinnedMesh vẫn bị nhân `matrixWorld` (scale 2)
      ⇒ nhân đôi transform: model to gấp 2 và skinning sai. Fix theo đúng chuẩn three.js:
      **giữ toạ độ LOCAL** + `bind(skeleton, mesh.matrixWorld)`, không bake normal.
      Đo được: world box của mesh = **y 0→2** đúng bằng model gốc (trước: 4×)
- [x] Thêm `RigAutoGen.rebindSkin()` — tính lại inverse bind + bindMatrix sau khi bones
      di chuyển (backend anchors), tránh bind pose lệch
- [x] **Màu/độ nét khác file gốc** — Texture Safe Mode downscale display xuống 512px,
      exporter lại dùng `tex.image` (bản 512) ⇒ ảnh xuất ra mờ, mất chi tiết/màu.
      Fix: tạm đổi sang `tex.userData.originalImage` (bản gốc) trong lúc ghi GLB.
      Đo được: ảnh xuất **1024×1024 đúng bằng bản gốc** (trước 512, 26–75KB)
- [x] **Mất `KHR_materials_specular`** của file Tripo ⇒ material nhìn khác.
      Fix: bật `includeCustomExtensions` + gắn lại extension từ JSON file nguồn
      → file xuất có `extensionsUsed: [KHR_materials_specular]` với giá trị y hệt gốc
- [x] **Normal map bị ghi JPEG** (chroma subsampling phá dữ liệu normal) → ép
      `RGBAFormat` cho normal map để ghi **PNG lossless** (đúng quy tắc sẵn có của project)
- [x] **Verify mạnh hơn**: `verifyGLB` giờ mô phỏng đúng công thức skinning của three.js
      để đo **mesh có biến dạng thật** khi phát clip (201/201 vertex mẫu dịch chuyển,
      max 0.0287) + đo kích cỡ model trong file (cao 2.0 đơn vị = gốc)
- [x] `loadDefault` bỏ qua file do app xuất ra (`_animated_`, `_opt`, `_hq`…) khi chọn
      model nguồn — tránh app tự load file đã rig/animate
- [x] **Kết quả đo thật** (`exports/kiemhiep_animated_9clips.glb`, 3,65 MB): 9 clip ·
      1 skin 23 joint · mesh biến dạng khi phát clip · cao 2.0 · texture 1024² ·
      giữ KHR_materials_specular · 0 extension bắt buộc → Blender/Unity/Meshy đọc trực tiếp

## Phase 25+ — Roadmap v5.1 🔜

- [ ] Tripo3D API thật (cần API key người dùng)
- [ ] TripoSR local WebGPU runtime
- [ ] Rapier3D physics WASM
- [ ] gif.js + ffmpeg.wasm encoder
- [ ] FBXLoader + Draco/Meshopt decoder
- [ ] Mesh simplifier (quadric decimation) cho LOD thật + giảm index < 65K để dùng u16
- [ ] Skin binding + weight painting
- [ ] Blend Tree + State Machine visual
- [ ] PixiJS game bundle runtime độc lập
