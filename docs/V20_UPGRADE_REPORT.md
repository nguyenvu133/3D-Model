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
