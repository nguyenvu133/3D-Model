# Mesh2Motion Engine + Studio v10.0 — Báo cáo

**Ngày:** 22/11/2026 · **Server:** `http://127.0.0.1:8099` (`node server.js 8099`)

Ba phần việc: (1) trang `mesh2motion.html` engine riêng, (2) sửa lỗi gizmo transform trong `index.html`, (3) nâng cấp Studio lên v10.0 và mở rộng AI 3D Generation.

---

## 1. Trang mới `mesh2motion.html`

Engine độc lập dựng theo spec trong prompt, dùng **Three.js + PixiJS** (cùng bộ thư viện với Studio), nạp **thư viện CC0 đã tải** (326 motion / 9 rig) và **dùng lại** hai module đã kiểm chứng `js/animation/m2m-motion.js` + `js/rigging/creature-rigs.js`.

### Bố cục (đúng spec)

| Vùng | Nội dung |
|---|---|
| Top nav | Logo, Explore, Use Your Model, Use Your Rigged Model, Remix, Favorites, GitHub, Settings, badge catalog, link về Studio |
| Left | 9 rig (Human/Fox/Bird/Dragon/Kaiju/Spider/Snake/Fish/Horse), search model, Import model, Rig, chọn họ rig, **30 card model** có thumbnail |
| Center | Viewport 3D: orbit/pan/zoom, grid + ground + shadow, 3 đèn, skeleton helper, wireframe, persp/ortho, focus, screenshot, reset, HUD FPS/tris/bone |
| Right | 4 tab: **Library** (search, category chip, sort, select all/clear, filter loopable/root-motion/favorites, 234 card), **Selected**, **Remix**, **AI Gen** |
| Bottom | Playback (prev/play/stop/next, 7 mức speed, loop, FPS 24/30/60), timeline ruler + playhead + timecode + frame, clip bar |

### Tính năng chạy thật

- **Model library**: 30 model (base + variation) có thumbnail, click → nạp GLB, tự nhận skeleton có sẵn (66 bone cho rig human)
- **Animation library**: 234 card từ catalog (9 rig tổng 326), mỗi card có checkbox, tag category, duration, badge ↻/RM, favorite ★, click để phát
- **Filter**: search tên + tag, 6 category (Idle/Combat/Movement/Emotion/Interaction/Action), sort theo name/category/duration, lọc loopable/root-motion/favorites
- **Playback**: play/pause/stop/restart, prev/next animation, speed 0.25×–2.0×, loop, FPS đổi được, step từng frame bằng ←/→
- **Timeline**: ruler có tick + nhãn giây, playhead bám thời gian thật, kéo để scrub, clip bar hiện tên + duration
- **Selected**: danh sách clip đã tick, đổi thứ tự ↑↓, play, thêm vào remix, bỏ; **export GLB** (model + các clip đã retarget) hoặc **export JSON**
- **Remix**: sequence nhiều clip, play tuần tự có **crossfade**, chỉnh transition 0–1s, lưu/nạp bằng localStorage
- **Import**: nút + kéo-thả GLB/GLTF/FBX; FBX dùng skeleton riêng, GLB có skin thì nhận skeleton có sẵn, mesh tĩnh thì bấm Rig để dựng theo họ
- **Retarget diagnostics**: hiện mode map (`identity-by-name` / `humanoid-map`), số bone khớp, số track sau retarget, danh sách bone thiếu
- **Settings**: màu nền, grid, shadows, wireframe, skeleton, FOV, orbit speed, UI scale — lưu localStorage
- **AI Gen tab**: prompt, negative, style, quality, polygon, texture, seed, batch 1/2/4, Image→3D, Rig+Animate, task list — dùng Tripo adapter, chưa có key thì báo “chưa kết nối”, không giả lập
- **Phím tắt**: Space, ←/→, F focus, G grid, X wireframe, S skeleton, 1/3/4/5/6/7/8 góc nhìn

### Kiểm thử trang mới

| Hạng mục | Kết quả |
|---|---|
| Badge catalog | `326 motions · CC0` |
| Chip rig | 9 |
| Card model | 30 |
| Card animation (human) | 234 · `234 / 234` |
| Nạp model human | 13.757 tris · **66 bone** |
| Phát animation | Run_Anime: 65 track, 0,95 travel · Sword_Regular_A: 65 track, **1,47** · Dance_Simple: 65 track, 1,27 |
| Click card → phát | `Angry · 65 track`, timecode chạy, playhead 14,8 %, nút đổi `⏸ Pause` |
| Tick 4 card → Selected | 4 dòng, badge 4 |
| Thêm 3 clip → Remix | 3 bước, play được (index 0, 1 dòng active) |
| Search “sword” | 13 kết quả |
| Sort duration | card đầu 0,13s |
| Đổi rig → Fox | 21 card (`21 / 21`) |
| Viewport buttons | wireframe, skeleton, grid, ortho↔persp, focus đều đúng |
| Export JSON 2 clip | 122.495 ký tự |
| Diagnostics | `identity-by-name`, khớp 65/66 bone, 65 track |
| AI tab | `not connected` (trung thực), có prompt |
| Page error | **0** |

Ảnh: [mesh2motion-page.png](m2m-v10/mesh2motion-page.png) · dữ liệu: [mesh2motion-page.json](m2m-v10/mesh2motion-page.json)

---

## 2. Sửa lỗi gizmo transform (X/Y/Z)

### Nguyên nhân

`js/viewport/interaction.js` bắt `pointerdown` ở **capture phase** trên `#viewport-canvas-wrap` để làm tính năng kéo object. Khi con trỏ đang ở trên tay cầm gizmo, handler này vẫn gọi `stopPropagation()` → **TransformControls (gắn trên `#three-canvas`) không nhận được `pointerdown`** → gizmo hiện ra nhưng kéo không di chuyển.

### Cách sửa

Handler nhường quyền tuyệt đối cho gizmo: nếu `tc.dragging` hoặc `tc.axis` khác null thì `return` ngay, không `stopPropagation`. Đồng thời `pointermove` cũng bỏ qua hover-highlight khi con trỏ đang trên gizmo.

### Kiểm chứng (chuột thật của Playwright, kéo 96 px mỗi trục)

| Trục | Vị trí trước | Sau | Delta |
|---|---|---|---|
| X | (0, 0, 0) | (0,648, 0, 0) | **+0,648** |
| Y | (0, 0, 0) | (0, 0,666, 0) | **+0,666** |
| Z | (0, 0, 0) | (0, 0, 0,845) | **+0,845** |

Chế độ gizmo: `move → translate/visible`, `rotate → rotate/visible`, `scale → scale/visible`, `select → hidden/disabled`. Page error 0.

Dữ liệu: [gizmo-xyz.json](m2m-v10/gizmo-xyz.json) · script: [qa-gizmo.mjs](<tools/qa-gizmo.mjs>), [qa-gizmo3.mjs](<tools/qa-gizmo3.mjs>), [qa-gizmo4.mjs](<tools/qa-gizmo4.mjs>), [qa-gizmo-z.mjs](<tools/qa-gizmo-z.mjs>)

---

## 3. Studio v10.0

- `PixiStudio.VERSION` = **10.0.0**; title/meta/boot/badge đổi sang v10.0
- Top bar có nút **Mesh2Motion** mở `mesh2motion.html`; trang m2m có link **← Studio** quay lại
- Giữ nguyên toàn bộ chức năng cũ (viewport, rig, animate, Mesh2Motion workspace, exporter…)

Kiểm thử: title `PixiJS Studio × Tripo3D AI Studio — v10.0`, version `10.0.0`, link `mesh2motion.html`, 0 page error.

---

## 4. AI 3D Generation — mở rộng

Thêm khối **🚀 AI 3D Generation Studio** vào panel AI của Studio ([ai-panel.js](<js/ai/ai-panel.js>)):

| Tính năng mới | Chi tiết |
|---|---|
| Prompt + negative prompt | ô riêng, giữ trạng thái khi re-render |
| Style | person / creature / object / vehicle / environment |
| Quality | standard / detailed |
| Polygon | 8k / 15k / 30k / 50k |
| Texture resolution | 1k / 2k / 4k |
| Seed | nhập tay hoặc auto |
| **Batch** | 1 / 2 / 4 task mỗi lần, seed tăng dần (+7) để ra biến thể khác nhau |
| Image → 3D | chọn file ảnh → `imageTo3D` |
| Template prompt | 5 mẫu (wuxia, slime, chest, hover bike, dungeon) |
| Kết quả đã sinh | nút **↓ tải GLB** và **↺ nạp lại vào viewport** cho từng task thành công |
| Trạng thái | `connected` / `chưa kết nối`; chưa có key thì mọi nút báo blocked, **không giả lập** |

Kèm 4 tool đã có vẫn chạy: Texturing, Upscale 4×, Auto Rig, Auto Animate.

Kiểm thử: khối render đúng, có prompt + nút Generate 3D, trạng thái `not connected` khi chưa nhập key, 0 page error.

---

## 5. File

**Mới**
- [mesh2motion.html](mesh2motion.html) — trang engine (layout + CSS + include)
- [m2m-host.js](<js/m2m/m2m-host.js>) — lớp tương thích PixiStudio cho trang độc lập
- [m2m-engine.js](<js/m2m/m2m-engine.js>) — viewport, model, rig, playback, timeline, remix, import, export, diagnostics
- [m2m-ui.js](<js/m2m/m2m-ui.js>) — toàn bộ UI + wiring + AI tab

**Sửa**
- [interaction.js](<js/viewport/interaction.js>) — nhường quyền cho gizmo
- [m2m-motion.js](<js/animation/m2m-motion.js>) — tự nhận dạng map `identity-by-name` theo tỉ lệ khớp tên bone ≥ 40%
- [ai-panel.js](<js/ai/ai-panel.js>) — AI 3D Generation Studio
- [utils.js](<js/core/utils.js>), [index.html](index.html) — v10.0 + link Mesh2Motion

**Script kiểm thử**: [qa-m2m-page.mjs](<tools/qa-m2m-page.mjs>), [qa-m2m-ui.mjs](<tools/qa-m2m-ui.mjs>), [qa-gizmo.mjs](<tools/qa-gizmo.mjs>), [qa-gizmo3.mjs](<tools/qa-gizmo3.mjs>), [qa-gizmo4.mjs](<tools/qa-gizmo4.mjs>), [qa-gizmo-z.mjs](<tools/qa-gizmo-z.mjs>), [qa-index-v10.mjs](<tools/qa-index-v10.mjs>)

## 6. Giới hạn

- PixiJS được dùng cho lớp UI/hiệu ứng theo kiến trúc project; phần **render 3D** là Three.js (spec ghi “engine pixijs” nhưng cũng liệt kê Three.js/GLTFLoader/AnimationMixer/OrbitControls — tôi bám theo danh sách kỹ thuật đó).
- Remix chỉ blend bằng crossfade giữa 2 action; **chưa** có blend cộng dồn (additive) hay blend theo bone.
- Export GLB dùng `GLTFExporter` nên bám spec glTF có sẵn; **chưa** có nén meshopt/Draco trong trang m2m (Studio có).
- AI Gen cần API key Tripo thật; không có key thì chỉ hiện trạng thái blocked.
- Trang m2m chưa có weight painting, chỉnh xương tay, hay multi-view image-to-3D (mỗi lần 1 ảnh).