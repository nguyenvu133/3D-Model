# V20.0 “Mixamo Ready” — Upgrade Report (2026-11-22)

Nâng cấp từ **v10.0.0** lên **v20.0.0**. Trước v20.0, số hiệu nằm rải rác
(README v5.0, `index.html` v10.0, `utils.js` `'10.0.0'`, FBX Creator v10.0,
topbar “Prototype v5.0”) nên không khớp nhau. Từ v20.0, số hiệu chỉ định
nghĩa ở **một chỗ duy nhất**: `js/core/version.js`.

## 1. Phiên bản thống nhất — `js/core/version.js` (mới)

- `PixiStudio.VERSION = '20.0.0'`, `VERSION_NAME = '20.0'`
- `PixiStudio.RELEASE = { version, name, codename: 'Mixamo Ready', date: '2026-11-22', previous: '10.0.0' }`
- `PixiStudio.CHANGELOG_V20` — 7 mục, dùng cho hộp thoại “Có gì mới”.
- `index.html` và `mesh2motion.html` đều load `version.js` **trước** `utils.js`;
  `utils.js` giữ `VERSION` sẵn có (`|| '20.0.0'`) để app vẫn chạy nếu thiếu file.
- Đã đổi: `index.html` (meta/title/boot/badge), `mesh2motion.html` (title/nav),
  `server.js` (banner), `package.json` (`name` + `version: 20.0.0` + script
  `check` / `qa:mixamo`), các chuỗi generator `v5.0` trong `save-manager.js` /
  `glb-writer.js` / `ai-panel.js` → `v20.0`, FBX Creator (binary + ASCII)
  ghi theo `PixiStudio.VERSION` đang chạy.
- Còn giữ nguyên (cố ý): số hiệu nội bộ của module con (`meshy-rigging`
  v5.0.6, `texture-manager` v5.0.8…) — đó là version module, không phải
  version Studio.

## 2. Sửa lỗi FBX Mixamo — `js/exporter/fbx-binary.js`

Ba lỗi đã chứng minh bằng test Node + three r128 (xem §5):

| # | Lỗi | Sửa |
|---|-----|-----|
| 1 | Geometry được bake bằng `xform` (xoay/dịch/scale về cao ~1.8) nhưng bone Lcl, Cluster `TransformLink` và BindPose vẫn dùng `matrixWorld` gốc → xương nhỏ/lệch hẳn so với mesh (vd: mesh cao 1.8 nhưng Hips vẫn ở y=0.25). | Tính `boneWorldX[b] = xform * b.matrixWorld` cho mọi xương trước khi ghi; `TransformLink`/`BindPose` dùng `boneWorldX`; bone Lcl suy từ `world'` của xương cha (`boneLocalX`, scale được bake vào xương gốc). |
| 2 | `upAxis: 'Y'` (mặc định, cả 2 nút Mixamo đều truyền) ép `axis = 1` nên model Z-up/X-up từ GLB Tripo/Meshy xuất ra vẫn **nằm ngang**, Mixamo không auto-rig được — dù comment ghi “mặc định tự nhận”. | `'Y'` / không truyền → tự nhận trục dài nhất (`dims.indexOf(max)`); chỉ `'X'`/`'Z'` mới ép trục. |
| 3 | Xoay X-up dùng `makeRotationZ(-90°)` đưa +X → −Y → nhân vật **lộn ngược** (đầu y=0, chân y=1.8) rồi mới dịch đáy về 0. | Đổi sang `+90°` (+X → +Y). Đã kiểm chứng: chân y=0, đầu y=1.8. |

Phụ: `OriginalUpAxis` trước đây ghi `upY ? 1 : -1` (ngược nghĩa, −1 không
phải trục) → giờ ghi đúng trục gốc `origAxis` (0/1/2). Report của bản
binary/ASCII sửa `format` theo version thật, `bones`/`clusters`/`hasSkin`/
`meshOnly` theo dữ liệu thật (trước đây bản ASCII hardcode 0/false), và
`upAxis` báo “baked” khi `xform` khác identity (trước đây chỉ báo khi xoay).

## 3. Mới — Mixamo Pre-flight — `js/exporter/mixamo-validator.js` (mới)

Kiểm tra **live THREE scene trước khi xuất**, không chạm DOM, không chặn
xuất trừ khi lỗi chắc chắn bị Mixamo từ chối:

- Lỗi chặn (`ok=false`): không có mesh; > 50.000 tam giác.
- Cảnh báo: không có xương/skin (sẽ mesh-only); xương không tên
  `mixamorig:*`; > 65 xương; > 1 mesh cùng skin 1 skeleton (exporter ghi
  chung 1 Skin); chiều cao ngoài 1.2–3.5 (exporter sẽ auto-scale); cao
  theo trục khác Y (exporter sẽ xoay); không có texture; mesh trang trí
  của xương bị bỏ qua.
- API: `PixiStudio.MixamoValidator.check(root, { mode: 'rig' | 'mesh-only' })`
  → `{ ok, errors, warnings, stats }`; `summary(result)` → 1 dòng tóm tắt.
- Đã nối vào `js/exporter/save-manager.js`:
  `mixamoPreflight(target, mode)` gọi ở `saveFBXMixamo` (trước khi ghi)
  và `saveFBXMixamoRig` (sau khi có rig, trước khi ghi). Lỗi chặn → toast
  error “Mixamo Pre-flight” + không ghi file; cảnh báo → gộp vào `warn[]`
  của toast thành công/cảnh báo như trước. Thiếu module validator → giữ
  hành vi cũ (không crash).

Quy tắc lấy từ `tools/fbx-validate-mixamo.mjs` (16 check trên file FBX
binary) và từ phân tích `X Bot.fbx`; các check cần file bytes (header,
version, connections, UV/normal, winding, open edges) vẫn chỉ chạy được
bằng tool Node đó — xem `npm run qa:mixamo`.

## 4. Mới — “Có gì mới v20.0”

- `js/ui/modals.js`: thêm `Modals.showWhatsNew()` — dựng như `showAbout`
  (title + body `U.el` + nút Close), nội dung lấy từ `CHANGELOG_V20`.
- `js/core/state.js`: thêm `seenVersion: ''` vào `State.settings` (bắt
  buộc phải có trong defaults thì `loadSettings()` mới copy từ
  localStorage).
- `js/core/app.js`: thêm `App._maybeShowWhatsNew()` — gọi sau `hideBoot()`
  trong nhánh load model mẫu thành công; nếu `seenVersion !== VERSION`
  thì hiện modal 1 lần rồi lưu `seenVersion = VERSION`.
- `index.html` + `js/ui/topbar.js`: thêm nút **What's New**
  (`#btn-whats-new`, cạnh nút Upgrade) để mở lại bất cứ lúc nào; đồng
  thời sửa message của nút Upgrade (“Prototype v5.0” → dùng
  `PixiStudio.VERSION`).
- `js/ui/modals.js`: About bỏ chữ “Prototype” (giờ là `v20.0.0`).

## 5. Kiểm thử đã chạy (2026-11-22)

- `node --check` cho mọi file JS đã sửa/thêm: `version.js`, `utils.js`,
  `state.js`, `app.js`, `modals.js`, `topbar.js`, `mixamo-validator.js`,
  `save-manager.js`, `fbx-binary.js`, `glb-writer.js`, `ai-panel.js` — đều OK.
- Validator (Node + three r128, `/tmp/test-fbx/test-validator.js`):
  model rig chuẩn → `ok=true`; > 50.000 tris → `ok=false` (chặn);
  model Z-up cao 0.5 → cảnh báo đúng trục Z + auto-scale; group rỗng →
  `ok=false`. **PASSED**.
- FBX exporter regression (test cũ với three r128): Y-up + autoScale —
  Hips y=0.9, Spine world tái tạo = 1.440 khớp TransformLink/BindPose;
  Z-up auto-detect — geometry Y 0..1.8, Hips y=0.9; X-up — chân y=0, đầu
  y=1.8 (trước fix: lộn ngược); đường `upAxis:'keep'` không đổi.
- Load order: `version.js` → `utils.js` trong Node cho `VERSION='20.0.0'`,
  `RELEASE.codename='Mixamo Ready'`, `CHANGELOG_V20` = 7 mục.
- Server: `node server.js 8899` → banner v20.0, `GET /` chứa `v20.0`,
  `GET /js/core/version.js` và `/js/exporter/mixamo-validator.js` đều 200.
  (Lưu ý: `meshoptimizer` chưa cài trong môi trường test nên API meshopt
  tắt — không liên quan tới bản nâng cấp; chạy `npm install` để bật.)

## 6. Cách dùng sau nâng cấp

1. Chạy `node server.js` (hoặc mở `index.html`), lần đầu sẽ thấy hộp
   thoại “Có gì mới trong v20.0”; mở lại bằng nút **What's New** trên topbar.
2. Import model → bấm **Save Mixamo** (mesh-only, Mixamo tự auto-rig)
   hoặc **Save Mixamo Rig** (khung 65 xương `mixamorig:*`). Nếu model
   vượt 50.000 tris hoặc không có mesh, studio báo lỗi Pre-flight và
   không ghi file; các cảnh báo khác hiện trong toast sau khi lưu.
3. Upload file FBX 2013 ra Mixamo: Characters → Upload Character.
4. Kiểm thử từ terminal: `npm run qa:mixamo` (validator file FBX),
   `npm run check` (verify cuối), `npm run verify:anim`.

## 7. Giới hạn đã biết (không giấu)

- Mixamo import thật vẫn cần tài khoản Adobe/Mixamo của người dùng — chưa
  test được upload thật trong phiên này; Pre-flight chỉ bắt lỗi biết trước.
- Validator trình duyệt kiểm tra scene, không kiểm tra được UV/normal/
  winding/open-edges trong geometry — các check đó vẫn nằm ở tool Node
  `tools/fbx-validate-mixamo.mjs`.
- “Face toward +Z” Mixamo vẫn cần kiểm tra bằng mắt (ảnh render) như trước.
- `mesh2motion.html` chưa load `modals.js`/`mixamo-validator.js` nên không
  có hộp thoại What's New / Pre-flight ở trang đó — chỉ có `version.js`.

## 8. File thay đổi

| File | Thay đổi |
|---|---|
| `js/core/version.js` | **mới** — single source of truth v20.0.0 + RELEASE + CHANGELOG_V20 |
| `js/exporter/mixamo-validator.js` | **mới** — Mixamo Pre-flight (scene-based) |
| `docs/V20_UPGRADE_REPORT.md` | **mới** — báo cáo này |
| `js/core/utils.js` | `VERSION` giữ từ `version.js`, header v20.0 |
| `js/core/state.js` | thêm `settings.seenVersion` |
| `js/core/app.js` | thêm `App._maybeShowWhatsNew()`, gọi sau `hideBoot()` |
| `js/ui/modals.js` | thêm `showWhatsNew()`, About bỏ “Prototype” |
| `js/ui/topbar.js` | binding `#btn-whats-new`, sửa message Upgrade |
| `js/exporter/save-manager.js` | `mixamoPreflight()` + nối vào 2 hàm Save Mixamo; generator `v5.0` → `v20.0` |
| `js/exporter/fbx-binary.js` | Creator theo `PixiStudio.VERSION` (binary + ASCII) |
| `js/exporter/glb-writer.js` | generator `v5.0` → `v20.0` |
| `js/ai/ai-panel.js` | header `(v10.0)` → `(v20.0)` |
| `index.html` | v10.0 → v20.0 (meta/title/boot/badge), thêm script `version.js` + `mixamo-validator.js`, thêm nút What's New |
| `mesh2motion.html` | v10.0 → v20.0 (title/nav), thêm script `version.js` |
| `server.js` | banner v5.0 → v20.0 |
| `package.json` | `name`, `version: 20.0.0`, script `check` / `qa:mixamo` |
| `README.md` | title + bảng phiên bản + mục “Có gì mới trong v20.0” + §1/topbar v20.0 |

Các sửa FBX exporter ở §2 đã đẩy lên `main` trước đó ở commit `0b7ba36`;
bản v20.0 này đẩy tiếp thành 1 commit riêng (xem git log).

## 9. Bổ sung v20.0 (đợt 2, 2026-11-22): PixiJS Engine + Tripo API v3

### 9.1 PixiJS Engine

- CDN: studio `pixi.js@7.3.2 → 7.4.3` (bản vá mới nhất dòng v7, đã kiểm
  tra trên jsDelivr); game `WUXIAMMORPG.html` `8.6.6 → 8.23.0`.
  Studio giữ dòng v7 vì v8 đổi API khởi tạo bất đồng bộ (`app.init()`)
  và Graphics — chuyển v8 sẽ vỡ overlay; trang game đã viết theo v8 nên
  lên 8.23.0 an toàn. Chuỗi engine trong export đổi sang `pixijs-7.4`.
- Mới — `js/renderer/pixi-effects.js` (`PixiStudio.PixiEffects`): particle
  emitter có cấu hình (preset burst/fire/magic/smoke, chung 1 radial
  texture, ngân sách hạt theo `setQuality('low'|'medium'|'high')`), vòng
  xung kích, chữ nổi 2D (`PIXI.Text`), flash màn hình, `stats()`.
  `PixiRenderer` khởi tạo effects trong `create()`, gọi `update(dt)` mỗi
  frame; `burst()` chuyển sang emitter (đường Graphics cũ còn làm fallback);
  thêm API `emit/ring/floatText/flash/effectsStats`.
- Click chọn model (`js/viewport/controls.js:pickAt`) giờ vừa bắn sparkle
  vừa hiện tên object nổi 2D tại vị trí click.
- Test: `/tmp/test-fbx/test-effects.js` (PIXI stub) — 23/23 đạt, gồm hạt
  chết hết sau 2s, quality low giảm nửa / high tăng gấp đôi.

### 9.2 Tripo API v2 → v3 (bắt buộc — v2 đã tắt 2026-10-31)

- `js/ai/tripo-adapter.js` viết lại theo docs chính thức
  (developers.tripo3d.ai, kiểm chứng 2026-11-22): base mới
  `https://openapi.tripo3d.ai/v3`, model `v3.1-20260211` (mặc định) /
  `v3.0` / `v2.5` / `P2-20260801` / `P1-20260311`, poll `GET /v3/tasks/{id}`
  mỗi 2s (tối đa ~10 phút), tải `output.model_url` ngay (hết hạn sau 5 phút).
- Mới: `multiviewTo3D()` (`inputs: [{front}, {left}, ...]`, front bắt buộc,
  tối thiểu 2 ảnh), `convertModel()` (GLTF/FBX/USDZ/OBJ/STL/3MF),
  `decimateModel()` (thay `upscale_model` đã bỏ ở v3), `uvModel()`,
  `segmentModel()`, `completeModel()` (Mesh Repair), `uploadFile()`
  (`POST /v3/files` → `file_token`), `getTask()`/`listTasks()`,
  `downloadResult()`.
- Rig đúng chuẩn docs: `rig-check` trước (lấy `rig_type`), rồi `rig`
  (`model: v3.0-20260909`, `spec: 'mixamo'`); Animate (`retarget`,
  `preset:walk/idle/run`) bị chặn khi model chưa rig (`lastCreatedKind`).
- `js/ai/ai-panel.js`: chọn model H3.1/P2 trong Generation Studio, nút
  “Multi-view → 3D”, tools grid đổi Upscale → Convert FBX + Decimate,
  endpoint mặc định v3, auto-update engine sửa sang `GET /v3/tasks/{id}`
  (trước đây gọi `/task/{id}` kiểu v2). `js/m2m/m2m-ui.js`: endpoint v3,
  toast rig mới.
- Test: `/tmp/test-fbx/test-tripo-v3.js` (fetch giả lập) — 50+ assert đạt:
  endpoint/payload v3 đúng docs, upload → file_token, multiview front/left,
  rig-check → rig (spec mixamo), retarget `preset:*`, chặn animate khi chưa
  rig, lỗi code v3 → failed, poll failed → failed, không còn request v2.
  **Chưa test với key thật** — cần key Tripo của người dùng (300 credit thử).
- Xem chi tiết tính năng Studio, giá/credit, giới hạn trong
  `docs/TRIPO_V20.md`.

### 9.3 File thay đổi (đợt 2)

| File | Thay đổi |
|---|---|
| `js/renderer/pixi-effects.js` | **mới** — PixiJS Effects Engine v20.0 |
| `docs/TRIPO_V20.md` | **mới** — Tripo Studio features + migration v2→v3 |
| `js/ai/tripo-adapter.js` | viết lại theo Tripo OpenAPI v3 |
| `js/ai/ai-panel.js` | chọn model, Multi-view, tools v3, auto-update v3 |
| `js/m2m/m2m-ui.js` | endpoint v3, toast rig |
| `js/renderer/pixi-renderer.js` | nối PixiEffects, burst qua emitter, API mới |
| `js/viewport/controls.js` | click chọn hiện tên nổi 2D |
| `js/core/version.js` | thêm 6 mục changelog (PixiJS + Tripo v3) |
| `js/exporter/exporter.js`, `js/exporter/save-manager.js` | chuỗi engine `pixijs-7.4` |
| `index.html`, `mesh2motion.html` | PixiJS CDN 7.4.3 (+ fallback unpkg) |
| `WUXIAMMORPG.html` | PixiJS CDN 8.23.0 |
| `README.md`, `docs/PHASES.md` | ghi chú PixiJS 7.4.3 / 8.23.0 + Tripo v3 |
