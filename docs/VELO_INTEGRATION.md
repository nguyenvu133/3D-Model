# Velo Integration — Map Editor ⇄ Velo (.scene)

Map Editor đọc/ghi được scene của **Velo** (game engine ngôn ngữ V,
kiến trúc Node + Component kiểu Unity, demo 3D ở
`examples/demo3d/`). Chỉ parse định dạng `.scene` công khai —
**không copy source code Velo**.

File liên quan (đừng sửa file khác khi đụng phần này):

| File | Vai trò |
|---|---|
| `js/mapeditor/velo/VeloImport.js` | Parser `.scene` (tokenizer + parse node lồng nhau) + convert sang SceneData + dựng vào MapEditor |
| `js/mapeditor/velo/VeloPrefabLibrary.js` | Registry 7 prefab demo3d, fetch `.scene` gốc + fallback nhúng sẵn |
| `js/mapeditor/velo/VeloExport.js` | Serialize SceneData → text `.scene` + `.meta` + cấu trúc project + README |
| `js/mapeditor/velo/VeloPanel.js` | Panel UI trong MapEditor (nút import/export/tải, xem trước text) |
| `MapEditor.html` | Chỉ thêm 4 script tag cho 4 file trên |

## 1. Định dạng `.scene` / `.meta`

`.scene` là **text**, đơn vị mét, y-up, model quay mặt +z:

```js
node Main {
  Environment3D { sky = [150, 165, 220]  ground = [95, 85, 90]  ambient = 0.85  fog_density = 0.02 }
  node Sun { DirectionalLight3D { direction = [-0.5, -1, -0.35]  intensity = 1 } }
  node Hero {
    Transform3D { }
    SkinnedModel3D { model = @asset("a3d0f8b1")  clip = "mixamo.com"  rim = 0.25 }
  }
}
```

- Node lồng nhau: `node Tên { ... }`, con là `node`, component `Tên { key = value }`,
  hoặc prop trần `key = value` (VD `position = [20, 16]` trong HUD).
- Giá trị: số (`-0.5`, `1.05`), chuỗi `"..."`, mảng `[r, g, b(, a)]`,
  `@asset("id")`, `true`/`false`. Comment bắt đầu bằng `#`.
- Prefab instance: `node Torch1 from @asset("d3a10006") { Transform3D { position = [...] } }`
  — `from` là prefab theo asset ID, Transform3D inline là override.
- `Transform3D`: `position` / `rotation` (euler **độ**) / `scale`.
- `.meta` (3 dòng, theo đúng file gốc): `id: <8-hex>`, `kind: model|scene|prefab`,
  `version: 1`. VD `assets/models/than_dieu_run.fbx.meta`:
  `id: a3d0f8b1 / kind: model / version: 1`.

Parser (`VeloImport.parse`) báo lỗi rõ **số dòng** (`Velo .scene lỗi dòng N: ...`),
không crash với file sai.

## 2. Asset IDs demo3d

| ID | File | Nội dung |
|---|---|---|
| `a3d0f8b1` | `assets/models/than_dieu_run.fbx` | **Hero Thần Điêu Fast Run** — chính là file `models/thandieu/Than_dieu_Fast_Run.fbx` của repo này |
| `d3a10002` | `assets/prefabs/orb.scene` | Orb (Core + Shell + Ring + Sparkles + PointLight) |
| `d3a10003` | `assets/prefabs/slime.scene` | Slime (Body + 2 mắt + Shine + Dust) |
| `d3a10004` | `assets/prefabs/drone.scene` | Drone (Body + Eye + Rotor + Blade + Exhaust + PointLight) |
| `d3a10005` | `assets/prefabs/golem.scene` | Golem (Torso + Rune + Head + 2 mắt + 2 tay + 2 chân + Dust) |
| `d3a10006` | `assets/prefabs/torch.scene` | Torch (Post + Bowl + Fire + Embers + Smoke + PointLight) |
| `d3a10007` | `assets/prefabs/tree.scene` | Tree (Trunk + 3 tầng cone Low/Mid/Top) |
| `d3a10008` | `assets/prefabs/crystal.scene` | Crystal (3 cone A/B/C + Glow + PointLight) |

Prefab fetch từ
`https://raw.githubusercontent.com/velo-engine/velo/3d/examples/demo3d/assets/prefabs/<tên>.scene`,
cache trong bộ nhớ. Fetch lỗi → dùng fallback nhúng sẵn trong
`VeloPrefabLibrary.js` (torch/tree **đúng nội dung file gốc đã đọc**,
5 prefab còn lại là primitive tương đương) + log warning, không crash.

## 3. Bảng map component Velo ↔ Map Editor

### Import (`.scene` → Map Editor)

| Velo | Map Editor |
|---|---|
| `Environment3D` (sky/fog/ambient) | `data.environment` (sky hex, fog near/far từ `3/fog_density`, timeOfDay 18) |
| `DirectionalLight3D` (Sun) | `environment.sun` (color/intensity/direction) |
| `Camera3D` + `FollowCamera` | Không thành object; lưu để focus camera vào Hero |
| `Ground` mesh `grid` | `terrain.size` (VD 240) + terrain phẳng; **không** thành object |
| `MeshRenderer3D` mesh `cube/sphere/cylinder/cone/plane/grid/disc/ring` | Primitive `box/sphere/cylinder/cone/plane` (đổi scale theo kích thước mesh gốc: sphere ÷1.2, cylinder/cone cao ÷1.2, plane ÷2) |
| `MeshRenderer3D` mesh `torus` | `portal` (scale ÷2.6) |
| `SkinnedModel3D` model `a3d0f8b1` | `hero` (node tên Hero) / `monster` (GoldRunner, ShadowRunner); `clip`/`speed`/`rim` giữ trong `velo` |
| `PathRunner` (kèm SkinnedModel3D) | `path` 8 điểm tròn + `velo.pathRunner {radius, speed, phase}` |
| `Particles3D` | Object hiển thị được theo preset: `fire/embers→campfire`, `portal→portal`, `heal/sparkle/magic→sphere`, `fireflies→lantern`, còn lại `box`; preset/rate/radius giữ trong `velo` |
| `PointLight3D` | `light` (`light: {color, intensity, distance: range}`); nếu node đã có mesh/particle thì gắn vào cùng object |
| `OrbSpawner {prefab, count, radius}` | Sinh `count` object `sphere` vàng (VD 10 orb, r=15), tag `velo.spawnerKey` để export gộp lại |
| Prefab instance `from @asset(...)` | **Mở rộng** thành các object con (transform cộng dồn instance ∘ root prefab ∘ con); override con cùng tên (VD Slime2 Body đổi màu) được áp vào đúng object con; object đầu tiên mang `velo.prefabRoot` + `velo.prefabTransform` để export gộp lại |
| `Health` / `Spin3D` | Giữ trong `velo` của object (`velo.health`, `velo.spin`) |
| `HeroController`, `HeroCombat`, `FollowCamera`, `SlimeHop`, `DroneHover`, `Trail3D`, `Bob3D`, `Pulse3D`, `HealZone`, `OrbPickup`, `GolemWalk`… | Chỉ logic V → **bỏ qua + ghi log** (đếm trong `skipped`) |
| `HUD` + toàn bộ subtree 2D (`Canvas/Label/Widget/UITransform/ProgressBar/StatsLabel`) | **Bỏ qua cả subtree + ghi log** (main.scene: 7 node HUD) |

Rotation Velo (độ) → MapEditor (radian) khi import, ngược lại khi export.
Màu Velo `[r,g,b]` 0–255 → hex MapEditor; alpha < 255 → `material.opacity`.

Sau import: `Hierarchy`/`Inspector`/`AssetManager.render()` nếu tồn tại
(guard từng cái), camera focus vào Hero, notify số object đã import +
số node bỏ qua. Hero sẽ thử load FBX thật
`models/thandieu/Than_dieu_Fast_Run.fbx` qua `MapEditor._loadThandieuFBX`
(nếu có file trong repo); chưa có thì giữ hero chibi + notify rõ.

### Export (Map Editor → `.scene`)

| Map Editor | Velo |
|---|---|
| `environment` | `Environment3D` + node `Sun` (`DirectionalLight3D`) |
| `terrain.size` | Node `Ground` (`grid`, `grid_cells = size/2`) |
| Primitive `box/sphere/cylinder/cone/plane/portal` | `MeshRenderer3D` (scale nhân ngược hệ số import) |
| `hero/monster/boss` hoặc object có `velo.modelId` | `SkinnedModel3D { model = @asset("a3d0f8b1")  clip = "mixamo.com" ... }` + `PathRunner` nếu có `velo.pathRunner` |
| Object có `velo.prefabInstance` | Gộp thành **1 node** `from @asset("id")` + Transform3D của instance; con nào màu khác prefab gốc → node override con (VD Slime2 `node Body { MeshRenderer3D { color = [240, 120, 160] } }`) |
| Object có `velo.prefabId` lẻ | 1 node `from @asset("id")` riêng |
| Object có `velo.spawnerKey` | Gộp thành 1 node `OrbSpawner { prefab count radius }` |
| Object có `velo.component === 'Particles3D'` | `Particles3D { preset ... }` |
| `light` / object có `light` | `PointLight3D { color intensity range }` |
| Type wuxia native (`temple/house/pine/...`) | Primitive gần đúng (`temple→cube`, `pine→cone`, `rock→sphere`…) — chỉ gần đúng, xem Giới hạn |
| `patrol`, object ẩn | Bỏ qua + warning |
| HUD | Không export |

`.meta` cho mỗi asset: id 8-hex ổn định = FNV-1a của tên file,
`kind: scene` (scene/prefab) hoặc `kind: model` (FBX).

Cấu trúc project export (`VeloExport.buildProjectFiles`):

```
assets/scenes/main.scene
assets/scenes/main.scene.meta
assets/prefabs/<tên>.scene.meta     (cho từng prefab đã dùng)
assets/prefabs/<tên>.scene          (chỉ khi prefab đã được tải/cache lúc export;
                                     nếu thiếu thì copy từ examples/demo3d/assets/prefabs/ của repo velo)
assets/models/than_dieu_run.fbx.meta
README-VELO.md
```

## 4. Cách dùng (trong Map Editor)

Panel **🎮 Velo — Import/Export .scene** ở cột phải:

1. **⬇ Import demo3d Velo** — fetch `main.scene` từ repo velo
   (nhánh `3d`) rồi dựng vào map. Mất mạng/GitHub chặn → báo lỗi, dùng nút 2.
2. **📂 Chọn file .scene…** — import file `.scene` bất kỳ (cùng parser).
3. **⬆ Export Velo (.scene) — xem trước** — sinh text `.scene` từ map
   hiện tại, hiện trong khung xem trước + báo số object/prefab/spawner.
4. **⬇ Tải main.scene** / **⬇ Tải .meta** / **⬇ Tải tất cả** — tải tuần tự
   (mỗi file cách nhau ~350ms để trình duyệt không chặn).
5. Copy file vào project Velo theo `README-VELO.md` tải kèm.

## 5. Giới hạn (nói thật)

- **Không copy source code Velo** — chỉ parse định dạng `.scene` công khai.
- **Game logic V không export**: `main.v` / `game.v` / `combat.v`
  (HeroController, Health, HeroCombat, OrbSpawner behaviour, PathRunner,
  SlimeHop, DroneHover…) vẫn phải viết bằng V trong project Velo.
- **Model FBX phải tự copy** (binary không kèm trong text export):
  copy `models/thandieu/Than_dieu_Fast_Run.fbx` → `assets/models/than_dieu_run.fbx`.
- **HUD 2D không import/export** (Canvas/Label/ProgressBar…).
- MapEditor không có NavMesh/physics Velo: `PathRunner` chỉ export lại
  tham số (radius/speed/phase), đường patrol MapEditor không có tương đương.
- Type wuxia native (đền/nhà/thông…) export thành primitive gần đúng,
  không phải prefab Velo.
- Particles3D trong MapEditor hiển thị bằng primitive tĩnh (campfire/sphere/…),
  không phải hệ particle thật của Velo.
- Import thay **toàn bộ scene** hiện tại (qua `loadData`, có push undo 1 lần);
  muốn giữ map cũ thì save project trước.
- Prefab fetch cần mạng tới `raw.githubusercontent.com`; mất mạng thì dùng
  fallback nhúng sẵn (torch/tree đúng gốc, 5 prefab còn lại đơn giản hoá).

## 6. Kết quả test (2026-11-24)

Script: `~/workspace/.test-mapeditor/test-velo-parser-quick.js`
(chạy `node` thuần, parser không cần THREE/DOM; `fetch` stub trả fixture
local `~/workspace/.test-mapeditor/fixtures/velo/` thay vì mạng).

**50 PASS, 0 FAIL.** Điểm chính với fixture `main.scene` thật (8.471 B,
53 node):

- Parse: 1 root `Main`; Hero `SkinnedModel3D` model `a3d0f8b1`; 4 torch
  (`from d3a10006`); 7 tree (`from d3a10007`); Portal; HUD; Environment3D
  sky `[150,165,220]` fog `0.028`; Slime2 có override Body.
- Lỗi parse báo đúng dòng (thiếu `}` → dòng 4; `@asset` sai → dòng 1).
- Prefab library: registry 7 prefab; resolve torch/tree từ fixture;
  id lạ → `null`, không crash; fallback torch parse được khi `noFetch`.
- Import: **123 object**, `SceneData.validate` không lỗi, terrain size 240,
  sky `0x96a5dc`, Hero đúng `heroId`; torch 4×5=20, tree 7×4=28,
  crystal 3×5=15, slime 2×5=10, drone 2×6=12, golem 10, OrbSpawner 10 orb;
  Slime2 Body override màu `[240,120,160]`; Torch1 Post đúng vị trí
  `[5.5, 0.6, 5.5]`; 2 runner có PathRunner + path 8 điểm; bỏ qua 11 node
  (Sun, Camera, 2 Trail, HUD 7 node); Ground không thành object.
- **Round-trip**: export (154 dòng, 123 object) → parse lại bằng chính
  importer → import lại được **123 object, tên + type từng object khớp**;
  export chứa `from @asset("d3a10006"/"d3a10007")`, `SkinnedModel3D a3d0f8b1`,
  `OrbSpawner count 10`, override Slime2 Body, không chứa HUD.
- Project files: `main.scene` + `main.scene.meta` + `.meta` cho 7 prefab +
  `.meta` model Thần Điêu + `README-VELO.md`; `.meta` đúng format 3 dòng.

Chưa test trên trình duyệt thật (cần mở MapEditor.html): nút import demo3d,
load FBX Thần Điêu, panel UI — xem §7.

## 7. Các bước user test

### Test import demo3d

1. Mở MapEditor (bản đã có 4 script velo) trên trình duyệt.
2. Cột phải → panel **🎮 Velo** → bấm **⬇ Import demo3d Velo**.
3. Kiểm tra: map thành arena 240×240; Hero ở giữa; 4 đuốc quanh quảng trường;
   7 cây thông; portal ở `[0, 0, 14]`; 10 orb vàng; slime/drone/golem;
   toast báo `Đã import 123 object, bỏ qua 11 node`.
4. Nếu có `models/thandieu/Than_dieu_Fast_Run.fbx` trong repo thì Hero
   thành Thần Điêu FBX thật; chưa có thì Hero giữ chibi + toast cảnh báo.
5. Mất mạng: bấm **📂 Chọn file .scene…**, chọn file `main.scene` local —
   kết quả giống hệt (prefab torch/tree dùng fallback đúng gốc).

### Test export Velo

1. Sau khi import demo3d (hoặc mở map bất kỳ), bấm
   **⬆ Export Velo (.scene) — xem trước**: khung preview hiện text
   `.scene`, status báo `Export OK: 123 object, … — parse lại được`.
2. Bấm **⬇ Tải main.scene**, mở file: phải có `node Main`,
   `Environment3D`, `node Torch1 from @asset("d3a10006")`,
   `SkinnedModel3D { model = @asset("a3d0f8b1") }`.
3. Bấm **⬇ Tải tất cả**: nhận `main.scene` + các `.meta` +
   `README-VELO.md` (+ `.scene` prefab nếu đã tải về).
4. Copy vào project Velo theo README, **tự copy file FBX**
   `models/thandieu/Than_dieu_Fast_Run.fbx` → `assets/models/than_dieu_run.fbx`.

## 8. Import cả thư mục project + cây project + tự cập nhật (2026-11-24 — chưa push)

### 8.1 Nút mở thư mục project Velo

Panel Velo (cột phải) có nút **"📁 Mở thư mục project Velo…"** (cùng trong cây Velo Project ở cột trái). Dùng `showDirectoryPicker()` (Chromium) với fallback `<input type="file" webkitdirectory>`.

**Hiện đường dẫn trước khi import** (theo yêu cầu user — không click là vào thư mục ngay): sau khi chọn thư mục, panel hiện tên thư mục + tổng số file quét được + số file theo loại (scenes/prefabs/models/scripts) + nút **"⬇ Import project này"** xác nhận và nút "Huỷ". Với webkitdirectory, đường dẫn hiển thị là tên thư mục + `webkitRelativePath` của từng file.

Quét đệ quy toàn bộ thư mục:
- `assets/scenes/*.scene` (scene)
- `assets/prefabs/*.scene` (prefab)
- `assets/models/*.fbx` / `.glb` / `.gltf` / `.obj` (model) + file `.meta` cạnh mỗi file
- `*.v` (script V: main.v, game.v, combat.v…)
- `velo.toml`, README.md

Resolve tham chiếu bằng `.meta` ID → file thật: prefab instance `from @asset("<id>")` mở đúng file prefab trong thư mục (đăng ký text vào `VeloPrefabLibrary`); SkinnedModel3D `model=@asset("<id>")` **load FBX thật từ thư mục qua blob URL** (không còn chibi placeholder khi file có trong thư mục).

### 8.2 Cây Project Velo

Panel mới **"📁 Velo Project"** ở cột trái, dưới Hierarchy. Đầu cây hiện tên project + đường dẫn thư mục đã chọn. Cây đúng cấu trúc Velo:

```
📁 <tên thư mục project>
├─ 📁 assets
│  ├─ 📁 scenes/   (main.scene…)
│  ├─ 📁 prefabs/  (torch.scene, tree.scene…)
│  └─ 📁 models/   (than_dieu_run.fbx…)
├─ 📁 scripts/     (main.v, game.v…)
├─ 📄 velo.toml
└─ 📄 README.md
```

Mỗi file: icon loại + tên + `.meta` ID (8-hex) + dung lượng. Click:
- `.scene` → load scene đó làm map (scene đang mở được theo dõi để phát hiện đổi file).
- prefab → chèn vào map hiện tại (tại tâm camera).
- `.v` → xem code chỉ-đọc: số dòng + tên `pub struct X` + tên `pub fn X` parse được + preview 200 dòng đầu.
- `.fbx` → load model vào map (qua Asset Manager).
- `.meta` → xem ID + kind + version.
- Thư mục → thu/mở cây.

Mục **"⚠ Chưa lưu vào project"**: model GLB/FBX đã import vào map trong phiên nhưng chưa có trong thư mục project — kèm `.meta` ID tự sinh (fnv1a theo tên file). Export Velo bao gồm cả các asset này (kèm file `.meta` trong project files; user tự copy file binary gốc vào `assets/models/`).

**Demo3d qua GitHub vẫn giữ**: nút "⬇ Import demo3d Velo" (fetch main.scene) — sau khi import xong, cây project hiển thị đúng cấu trúc demo3d (scenes/prefabs/models/scripts) với các file đã tải làm fixture; model `than_dieu_run.fbx` hiện kèm ghi chú "chưa có trong thư mục — upload file vào models/thandieu/ rồi import lại".

### 8.3 Tự cập nhật (auto-update)

- Giữ directory handle khi dùng `showDirectoryPicker()` → nút **"🔄 Quét lại"** + tự quét lại khi window focus + mỗi 10 giây (chỉ khi có handle; so sánh danh sách file + size/mtime).
- File mới/mất/đổi → cây tự cập nhật (badge "● đã đổi" trên file scene đang mở).
- **Scene đang mở đổi → hiện nút "↻ Scene đã đổi — Tải lại", KHÔNG tự tải lại lặng lẽ khi đang sửa.**
- Fallback webkitdirectory (không có handle): nút "Quét lại" yêu cầu chọn lại thư mục, ghi rõ trong panel.

### 8.4 Giới hạn (nói thật)

- **Không chạy code V** — chỉ đọc/xem (parse `pub struct`/`pub fn`, preview 200 dòng). Muốn chạy game Velo thật thì dùng Velo engine.
- `showDirectoryPicker()` chỉ có trên Chromium (Chrome/Edge). Safari/Firefox dùng fallback `webkitdirectory`.
- **Đường dẫn hiển thị là tên thư mục + relative path** — trình duyệt không cho đọc đường dẫn tuyệt đối thật trên máy user (bảo mật). Đây là giới hạn của trình duyệt, không phải bug.
- Tự quét lại 10s chỉ hoạt động khi có directory handle (Chromium). Với fallback, phải bấm "Quét lại" và chọn lại thư mục.
- FBX load từ thư mục qua blob URL — cần FBXLoader + fflate CDN (đã có trong MapEditor.html).

### 8.5 Test

Harness `~/workspace/.test-mapeditor/test-velo-folder-mapeditor.js` (fixture thư mục Velo giả lập trong `~/workspace/.test-mapeditor/fixtures/velo-folder/`: main.scene thật + 2 prefab + 2 `.meta` + 1 file `.v` mẫu + `velo.toml`):
- (a) quét thư mục → cây đủ scenes/prefabs/models/scripts, resolve `.meta` ID đúng, load FBX từ blob (stub), click scene đổi map;
- (b) auto-update: thêm/xoá file → re-scan → cây đổi đúng; scene đang mở đổi → flag "đổi" xuất hiện, không tự reload;
- (c) layout: chiều cao các section `#me-right` → Inspector body min-height ≥220px sau khi thu gọn các section khác;
- (d) camera: ortho toggle đổi camera type, FOV slider đổi fov, focus-fit khớp công thức Studio, bookmark lưu/load;
- (e) kết nối: click nút Map Editor → href đúng; write lỗi → download + panel hướng dẫn.

Kết quả (2026-11-24): **`test-velo-folder-mapeditor.js`: 140/140 PASS × 2 vòng** (vòng 1: 140/140 sau khi sửa 3 bug thật tìm được khi viết test; vòng 2: 140/140). Hồi quy cùng ngày: `test-mapeditor.js` 96/96, `test-velo-mapeditor.js` 69/69, `test-fbx-mixamo.js` 73/73. `node --check`: 15/15 file JS mới/sửa OK. Server smoke: 13/13 file 200.

## 9. Bảng component mở rộng — 35 prefab mới (2026-11-24 — chưa push)

Bảng này mở rộng §3 cho 35 prefab mới trong `Placement.NEW_TYPES`. Export dùng `VeloExport.NATIVE_MESH` (đã bổ sung đủ 35 loại): prefab mới nào cũng export được thành `MeshRenderer3D` mesh gần đúng — **không còn fallback `cube` mù** cho prefab mới. Object nào có `light` (đèn lồng 3 màu, bếp đá) thì export thêm `PointLight3D` cùng node (xem `objectNodeLines`: `lightLines(o)` gắn sau mesh).

### 9.1 Export (Map Editor → `.scene`)

| Prefab Map Editor | Component Velo khi export | Ghi chú |
|---|---|---|
| `pagoda`, `torii_big`, `house_tile`, `house_thatch`, `house_flat`, `stall`, `bridge_arch`, `well_stone`, `fence_wood`, `statue_dragon`, `chest`, `banner`, `stone_steps`, `stone_path`, `stone_stove`, `wolf`, `villager_blue`, `villager_red`, `villager_yellow` | `MeshRenderer3D` mesh `cube` | Hình hộp gần đúng, giữ nguyên vị trí/quay/scale + màu (nếu có `color`). Tượng rồng / chùa / nhà chỉ còn là khối hộp — mất chi tiết mái cong, sừng, vòm. |
| `pine_snow`, `pine_tall`, `pine_short` | `MeshRenderer3D` mesh `cone` | Tán thông → nón; thân + tuyết phủ mất, chỉ còn 1 nón. |
| `sakura`, `mushroom`, `crystal_red`, `crystal_blue`, `crystal_purple`, `lantern_red`, `lantern_yellow`, `lantern_blue`, `cloud`, `bird`, `bat` | `MeshRenderer3D` mesh `sphere` | Khối cầu gần đúng, giữ màu. Tinh thể mất hình bát diện + phát sáng (`emissive` chỉ export khi có `velo.emissive` trong data — mặc định không có). |
| `coin` | `MeshRenderer3D` mesh `cylinder` | Đĩa xu → trụ tròn; độ dày xu giữ qua scale. |
| `stream` | `MeshRenderer3D` mesh `plane` | Dải nước → mặt phẳng; độ trong suốt **không** export (material opacity chỉ export khi `dataObj.material.opacity` có — suối không set). |
| `lantern_red`, `lantern_yellow`, `lantern_blue`, `stone_stove` | `MeshRenderer3D` mesh `sphere`/`cube` **+ `PointLight3D`** | Có `light` trong data (`color 0xff8a2a, intensity 0.8, distance 12`) nên export thêm `PointLight3D { color intensity range }` cùng node. |
| `bird`, `bat` | `MeshRenderer3D` mesh `sphere` | **Không** có cánh đập trong Velo — animation đập cánh là code riêng của MapEditor (`animateFlying`), Velo chỉ nhận 1 khối cầu tĩnh. |
| `villager_blue`, `villager_red`, `villager_yellow`, `wolf` | `MeshRenderer3D` mesh `cube` | **Không** phải `SkinnedModel3D`: chỉ `hero`/`monster`/`boss` (hoặc object có `velo.skinned`/`velo.modelId`) mới export thành `SkinnedModel3D { model = @asset("a3d0f8b1") }`. Dân làng/sói trong Velo là khối hộp tĩnh, không đi patrol, không có clip animation. |
| `cloud` | `MeshRenderer3D` mesh `sphere` | **Không** trôi trong Velo — drift theo +x là code riêng của MapEditor (`updatePlay`); Velo nhận cầu trắng tĩnh, độ trong suốt không export. |

### 9.2 Prefab KHÔNG export được (hoặc export mất tính năng) — và vì sao

| Prefab | Mất gì khi export Velo | Vì sao |
|---|---|---|
| `bird`, `bat` | Mất cánh đập + bay lượn | Velo `.scene` không có component "đập cánh"; `animateFlying` là hàm JS riêng của MapEditor, không có dạng component Velo tương đương. Muốn bay trong Velo phải viết script `.v` riêng. |
| `cloud` | Mất trôi + mất trong suốt | Không có component drift/opacity trong export; `material.opacity` của prefab không nằm trong `dataObj.material` nên `meshLines` không đọc được. |
| `stream` | Mất trong suốt (thành mặt phẳng đục) | Như trên: độ trong suốt nằm trong material của mesh, không trong data object. |
| `crystal_red/blue/purple` | Mất phát sáng (`emissive`) | `emissive` chỉ export khi object có `velo.emissive` trong data; prefab mặc định không set `velo`. |
| `villager_*`, `wolf` | Mất hình người/sói + mất animation Idle | Chỉ 3 loại `hero`/`monster`/`boss` được map sang `SkinnedModel3D` (model `a3d0f8b1` duy nhất); dân làng/sói không có file model riêng nên không có gì để trỏ `model = @asset(...)`. |
| `pagoda`, `statue_dragon`, `house_tile`, `stall` | Mất toàn bộ chi tiết hình học (mái cong, sừng rồng, mái vải sọc) | `MeshRenderer3D` chỉ có mesh nguyên thuỷ (`cube/sphere/cylinder/cone/plane/torus/...`); prefab MapEditor là Group nhiều mesh, export chỉ lấy 1 mesh gần đúng. Muốn giữ nguyên hình phải export thành prefab Velo riêng (`from @asset(...)`) — chưa làm. |
| `bird`, `bat`, `wolf`, `villager_*` (patrol) | Không đi patrol trong Velo | `PathRunner` chỉ gắn cho node `SkinnedModel3D` (`isSkinned`); các prefab này export dạng mesh thường nên không có `PathRunner`. |

### 9.3 Import (`.scene` → Map Editor) — chiều ngược lại

Không đổi so với §3: Velo `.scene` import vào vẫn chỉ nhận các component đã map ở §3 (`MeshRenderer3D` → primitive/box, `SkinnedModel3D` → hero/monster/boss, `Particles3D` → campfire/sphere/…, `PointLight3D` → light). Các mesh `cone`/`sphere`/`plane`/`cylinder` từ prefab mới export ra, khi import lại sẽ về đúng primitive tương ứng (`cone` → `cone`, `sphere` → `sphere`, …) — tức là **round-trip mất hình dạng prefab gốc** (chùa → hộp, thông tuyết → nón, tinh thể → cầu) nhưng không mất vị trí/scale/màu. Đây là giới hạn đã biết của cầu nối primitive, không phải bug.

### 9.4 Test

Harness `~/workspace/.test-mapeditor/test-velo-prefabs-mapeditor.js` §(f): export map mặc định 179 object bằng `VeloExport.generate` ra 28.816 ký tự `.scene`, chứa node `Crystal_Red`, `Villager_Blue_1`, các mesh `cone`/`sphere`/`plane`/`cylinder`, `PointLight3D`, và `VeloExport.validate()` ok. **62/62 PASS × 2 vòng** (xem docs/MAP_EDITOR.md §9.4).

## 9. Chuỗi load FBX Thần Điêu + bản port JS "Run Velo" (2026-11-24)

### 9.1 FBX load chain — Hero phải là Thần Điêu thật

`VeloImport.loadHeroFBX(heroId)` thử theo thứ tự, dừng ở bước đầu tiên thành công,
mỗi bước lỗi ghi rõ vào status + warnings (không im lặng giữ chibi):

1. FBX từ **thư mục project Velo** (blob URL qua `setModelFile`, đã có từ trước).
2. **Fetch binary từ GitHub**: `https://raw.githubusercontent.com/velo-engine/velo/3d/examples/demo3d/assets/models/than_dieu_run.fbx`
   (3,797,328 B, đã kiểm chứng 200) với **tiến độ tải (%, MB)** hiện trong panel Velo
   → `FBXLoader.parse(arrayBuffer)` — không cần upload file FBX lên repo. Mất mạng/CORS
   thì sang bước 3.
3. File local `models/thandieu/Than_dieu_Fast_Run.fbx` trong repo (HEAD check).
4. Nút **"📂 Chọn file FBX Thần Điêu…"** trong panel Velo — user chọn file FBX trên
   máy/điện thoại → `loadHeroFBXFromBuffer` parse ngay, chỉ lưu blob trong phiên,
   **không upload đâu cả**.
5. Tất cả thất bại → giữ chibi + panel hiện rõ lý do + **3 cách khắc phục**
   (chọn file FBX / kiểm tra mạng rồi import lại / upload FBX vào `models/thandieu/`).

Bug đã sửa trong `MapEditor._loadThandieuFBX`: trước đây chỉ gom clip từ 2 file anim
phụ, bỏ qua clip của chính file base — file `than_dieu_run.fbx` chứa sẵn clip
`"mixamo.com"` (Fast Run 0.533s) nên giờ gom cả `fbx.animations` của base. Hàm nhận
cả URL string lẫn ArrayBuffer/Uint8Array đã fetch (`FBXLoader.parse`). Runners
Gold/Shadow parse lại cùng ArrayBuffer/URL với màu/emissive như `main.scene`:
Gold [255,215,120]/[70,45,0], Shadow [90,70,130]/[40,10,80] (`opts.tint`).
Mỗi object FBX có entry riêng trong `MapEditor._thandieuById` (mixer/clips/runClip/
idleClip/idleFrame); vòng lặp boot update tất cả mixer. `computeThandieuIdleFrame`:
sample clip Run từng frame bằng AnimationMixer, đo khoảng cách world của 2 bone
`mixamorigLeftFoot`/`mixamorigRightFoot` (tên Velo không dấu hai chấm), lấy frame
nhỏ nhất — đo được **t = 0.244s** trên fixture thật (khoảng cách chân 0.304m,
nhỏ nhất trong 25 mẫu). Panel Velo hiện trạng thái Hero: ✓ FBX thật / ⚠ chibi +
lý do + nút chọn file.

### 9.2 Bản port JS "Run Velo" — chơi trong trình duyệt, không cần engine V

`js/mapeditor/velo/VeloPlay.js` (`MapEditor.VeloPlay`, `VeloPlay.Core` logic thuần
test được bằng node). **Đây là bản port JS chạy bằng three.js trong trình duyệt —
KHÔNG chạy engine V, KHÔNG biên dịch code V**; logic `.v` (game.v/combat.v/main.v,
công khai trong repo velo-engine/velo) chỉ được đọc để port các con số + quy tắc
sang JS, code viết lại hoàn toàn. Xem bảng port + cách chơi trong docs/MAP_EDITOR.md
§8.6. Nút ▶ Run Velo được thêm bằng JS trong `VeloPlay.init` (không sửa
MapEditor.html); `VeloPlay.js` được nạp động từ `VeloPanel.init`.
`Viewport3D.updatePlay` gọi `VeloPlay.update(dt)` khi VeloPlay active (không chạy
patrol cũ); `setPlaying(false)` dừng VeloPlay; `MapEditor` chỉ nối dây start/stop
+ phím R (có scene Velo → start, chưa có → notify rõ) + chặn phím editor khi
đang chơi. CSS chỉ append rules mới cuối `css/map-editor.css` (marker VELO PLAY).

### 9.3 Test (harness mới)

`~/workspace/.test-mapeditor/test-velo-play-mapeditor.js` (jsdom + three r128 thật +
FBXLoader thật, fixture `fixtures/velo/than_dieu_run.fbx`): **72/72 PASS × 2 vòng**
(2026-11-24). Nội dung: (a) chuỗi load FBX — mock fetch trả binary thật → parse ra
SkinnedMesh 129,399 verts + clip mixamo.com 0.533s; mock fetch lỗi → chibi +
warning đúng; file picker stub → FBX thật; idle_frame 0.244 ∈ [0, 0.533];
(b) Core thuần — WASD 1s ≈ 5m (4.58m), dash >3m/0.3s, arena clamp 24m, autopilot
sau 5s, nhặt orb +1 + respawn r 3–16, slime hop/bump damage 1, bolt damage 2,
hero chết reset orbs 0 + hồi sinh 2s, kills +1 + enemy hồi sinh 6s, camera lerp
1s còn <0.5m (0.018m), HealZone 1 HP/s, thắng 20 orb, drone gun, golem slam
damage 2; (c) Run/Stop — phím R start, Esc stop, snapshot/restore vị trí hero +
orb, map không mất object (123), `setPlaying(false)` dừng VeloPlay, R khi chưa
có scene Velo → notify rõ. Hồi quy cùng ngày: `test-velo-folder-mapeditor.js`
140/140, `test-mapeditor.js` 96/96, `test-velo-mapeditor.js` 69/69,
`test-fbx-mixamo.js` 73/73. `node --check`: 5/5 file JS mới/sửa OK. Server smoke:
9/9 file 200.

Trong quá trình viết harness đã bắt được 4 bug thật và đã sửa: (1) `st.orbs` vừa
là số đếm vừa là mảng → đổi số đếm thành `orbCount`; (2) hero trong `Core.newState`
thiếu trường `hp`/`maxHp` → `damageHero`/`HealZone` ra NaN; (3) `VeloPlay.start`
ghi đè phương thức `_snapshot` bằng dữ liệu snapshot → đổi tên method thành
`_takeSnapshot`; (4) `hasVeloScene` nhận cả scene mặc định (có hero thường) →
chỉ tính dấu vết Velo (modelId/prefabId/veloId/spawner/healZone).

## 10. V Code Runner offline — dịch V→JS trong trình duyệt (2026-11-24 — chưa push)

### 10.1 Đây là gì — và không phải là gì

- **Là:** bộ dịch **subset V** chạy 100% trong trình duyệt (tokenizer +
  parser + codegen bằng JS thuần, không thư viện ngoài, không fetch,
  không gọi API, không cần mạng, không cần cài V/Velo). Đủ để chạy các
  component `game.v` / `combat.v` của demo3d Velo (HeroController,
  FollowCamera, SlimeHop, DroneHover, GolemWalk, OrbPickup, Health,
  HeroCombat, GolemSlam, DroneGun, HealZone, PathRunner, Bob3D, Spin3D,
  Pulse3D, StatsLabel, OrbSpawner). File mới
  `js/mapeditor/velo/VCodeRunner.js` (1.972 dòng); `VeloPanel.js` thêm
  panel V Code; `VeloPlay.js` chỉ thêm cầu nối. `VCodeRunner.js` được
  nạp động bằng JS (cùng cơ chế `VeloPanel.js` nạp `VeloPlay.js`),
  không sửa `MapEditor.html`.
- **Không phải:** trình biên dịch V thật, không chạy engine V. Logic
  game vẫn là bản port JS (VeloPlay Core) + component V dịch ra chạy
  cùng. Tự viết lại theo **ý tưởng** v2js của Velo (xem §10.3), không
  dùng code Velo/v2js.

### 10.2 Cách dùng panel "V Code" (cột phải MapEditor)

1. Import scene Velo trước (panel Velo → "Import demo3d Velo") — cần
   có Hero thì nút Chạy mới chạy được game.
2. Dán code V vào ô soạn (có số dòng), hoặc bấm **"📂 Chọn file .v…"**
   (nhiều file, đọc offline bằng FileReader), hoặc **"📋 Ví dụ game.v"**
   (nạp component SpinBob mẫu).
3. Bấm **"▶ Chạy code V"**: dịch → lỗi thì dừng + hiện từng lỗi kèm
   số dòng (bấm vào lỗi để nhảy tới dòng đó); dịch OK thì đăng ký các
   struct component vào VeloPlay rồi chạy game như Run Velo thường.
4. Bấm **"⏹ Dừng"**: gỡ component V đã đăng ký, khôi phục map như
   VeloPlay.stop. **"💾 Lưu"** lưu code đang soạn vào
   `localStorage` (`mapeditor.vcode`), tự nạp lại khi mở panel.

Gắn component vào node theo tên (mặc định): HeroController /
HeroCombat / Health(hero) → Hero; FollowCamera → Camera; SlimeHop →
slime; DroneHover/DroneGun → drone; GolemWalk/GolemSlam → golem;
PathRunner → runner; OrbPickup/Bob3D/Spin3D/Pulse3D → orb; Health →
cả hero (team hero) + mỗi enemy (team enemy); tên lạ → Hero.

### 10.3 Bảng ánh xạ v2js (ngữ nghĩa Velo → JS)

| V | JS sinh ra |
|---|---|
| `struct Name { field type = default }` | `class Name extends VR.Component` (constructor gán default, `Name.__fields = [...]` liệt kê field serializable như v2js) |
| `pub fn (mut h T) update(dt f32)` | method của class (`h` → `this`) |
| `fn name(a int, b f32) ret` | `function name(a, b)` (bỏ kiểu) |
| `mut x := v` / `x := v` / `=` | `let x = VR.__copy(v)` / gán (xem chú thích Vec3) |
| `f32(x)` / `f64(x)` | `Number(x)` |
| `int(x)` / `i64(x)` | `Math.trunc(x)` |
| `u8(x)` | `VR.__u8(x)` (kẹp 0–255) |
| `?T` | giá trị hoặc `null`; `x := f()?` → `if (x == null) return null;` |
| `!T` (lỗi) | `or { ... }` → kiểm tra null + chạy khối dự phòng; không có exception V |
| `expr or { return }` / `or { continue }` | `let __orN = (expr); if (__orN == null) { ... }` (chạy inline, giữ được return/continue) |
| `if mut h := f() { ... }` | `let __bN = f(); if (__bN != null) { let h = __bN; ... }` |
| `enum` (`.space`, `.j`, `.e`) | chuỗi `'space'`, `'j'`, `'e'` |
| `map[K]V` | `Map` (`in` → `Map.has`, `[k]` → `get`/`set` qua `VR.__getIndex/__setIndex`, `.len` → `.size`) |
| `[]T` | `Array` (`.len` → `.length`, `<<` → `VR.__append`, `pop()` giữ nguyên) |
| `math.sin/cos/sqrt/abs/min/max/pow/atan2/pi` | `Math.*` (`pi` → `Math.PI`) |
| `rand.f32()` | `VR.rand.f32()` → `Math.random()` |
| `core.vec2/vec3` | `VR.core.vec2/vec3` (Vec2/Vec3 JS, xem dưới) |
| `core.rgba(r,g,b,a)` | `VR.core.rgba` → `{r,g,b,a}` |
| `core.Node.new('X')` | `VR.core.Node.new` |
| `render3d.transform3d(node)` | `VR.render3d.transform3d` → Transform3D wrapper |
| `get_component[Foo]()` | `get_component("Foo")` (tên kiểu thành chuỗi, thêm vào cuối args) |
| `child_component[Foo](n, name)` | `child_component(n, name, "Foo")`; hàm generic `fn f[T](...)` nhận thêm tham số ẩn `__T0` |
| `a + b` / `a - b` / `a * b` / `a / b` | `VR.__add/__sub/__mul/__div` — tự nhận biết Vec3/Vec2 (cộng/trừ/nhân scalar theo từng thành phần), số và chuỗi giữ nguyên |
| `x in m` / `x !in m` | `VR.__in(x, m)` (`Map.has` / `Array.includes`) |
| `'...${expr}...'` | template literal `` `...${expr}...` `` |
| `// comment`, `module`/`import`, `@[...]` | bỏ qua |
| `unsafe { nil }` | `null`; `unsafe { stmts }` ở vị trí lệnh → chạy các lệnh trong khối |
| `if cond { a } else { b }` dạng biểu thức | toán tử 3 ngôi `(cond ? a : b)` (kể cả `else if`) |
| `for _ in 0..n` / `for x in arr` / `while` | `for` số / `for...of` / `while`; `for cond {}` → `while` |
| `return a, b, c` | `return [a, b, c]` (gán nhiều `[a, b] = f()` destructuring) |
| `eprintln(err)` / `println(x)` | `console.error` / `console.log` |

**Vec3 là kiểu giá trị trong V, tham chiếu trong JS** — mọi phép
gán/khai báo/trả về đều qua `VR.__copy()` (clone Vec2/Vec3, còn lại
giữ nguyên) để `home = tr.position` không bị kéo theo khi
`tr.position` đổi. `Transform3D.position/rotation/scale` là Vec3
"sống" (ghi `tr.position.x = 5` đổi thẳng object THREE); riêng
`rotation` dùng **độ** như Velo, tự đổi sang radian cho THREE.

### 10.4 Subset V hỗ trợ (đủ cho game.v/combat.v)

- Khai báo: `module`/`import` (bỏ qua), `pub struct`, `pub fn`
  (method + hàm thường + hàm generic `[T]`), `const`, comment `//`.
- Lệnh: `:=` (kể cả `a, b := ...`, `mut a, mut b := ...`), `=`,
  `+= -= *= /=`, `++ --`, `<<` (append), `if/else if/else`,
  `for _ in a..b`, `for x in arr`, `for k, v in map`, `while`,
  `for cond {}`, `return`/`continue`/`break`.
- Biểu thức: số (`1e9`, `0.5`, `1_000`), chuỗi `'...'` + nội suy
  `${...}`, `true/false/none/nil`, `+ - * / %`, so sánh, `&& || !`,
  `..` (chỉ trong for), `.len`, `in`/`!in`, gọi hàm/method, index
  `a[i]`, field `.x`, cast, struct literal `Type{...}` /
  `Type{x: 1, y: 2}` / `&Type{...}`, array literal `[a, b]`,
  `[]T{}`, closure `fn [mut n] () { ... }` (thành arrow function),
  if-expression, `or { ... }`, `?` ở cuối lệnh gán/khai báo.
- **Không dịch được → lỗi kèm số dòng, không sinh JS sai:**
  `spawn`/`go`/channel/`lock`, C interop (`C.xxx`), `$for`,
  `$embed_file`, `$if`, `asm`, `goto`, `defer`, `match`, `select`,
  `enum` (dùng string thay thế).

### 10.5 Cầu nối runtime `VR` (VeloRuntime)

`VCodeRunner.makeRuntime(hooks)` tạo object `VR` duy nhất mà code V
dịch ra được gọi. `hooks` (tùy chọn, có mặc định stub để test):
`inputState()` (trục/phím/chuột), `now()` (thời gian scene),
`getStore`/`onStoreSet` (đồng bộ store), `createObject(name)`
(tạo THREE.Group), `log`.

- `VR.core`: `vec2/vec3/rgba/Node/Component`.
- `VR.render3d`: `transform3d(node)`, `world_matrix(node)`.
- `VR.scene`: `find(path)` (cây node `World/Hero`, `World/Orbs`,
  `Camera`, ...), `store`, `time`, `unscaled_dt`, `after`,
  `instantiate` (trả `null` — chưa hỗ trợ spawn prefab từ V).
- `VR.input`: `axis_x()/axis_y()`, `axis(a,b)`, `was_pressed(key)`,
  `mouse_down/mouse_pressed/mouse_released`, `mouse` (Vec2).
- `VR.store`: `get_int/set_int/get_string/set_string/get_bool/set_bool`
  (đồng bộ 2 chiều với VeloPlay Core khi chạy thật: `orbs`/`kills`/
  `hp`/`max_hp`).
- Component: `node`, `scene()`, `input()`; lifecycle `start/update`.
- Node: `find/get_component/get_components/add_component/add_child/
  destroy/after`, `parent/children/active`, `transform()`.
- Transform3D: `position/rotation/scale` (rotation theo độ),
  `forward()`, `face(dir)`, `turn_toward(dir, maxDeg)`.

**Vòng lặp:** `VeloPlay.update()` chạy `Core.step` →
`_applyToScene` → `update(dt)` của từng component V → `_syncVToCore`
(đọc vị trí THREE object trả lại Core state: hero x/z/yaw, enemy
x/z, orb x/z, camera yaw). Khi có V `HeroController`, Core bỏ input
+ autopilot + dash/slash/bolt của nó; khi có V `SlimeHop`/
`DroneHover`/`GolemWalk`/`PathRunner`, Core bỏ nhánh di chuyển của
đúng loại enemy đó (`st._vSkip`). API tối thiểu thêm vào VeloPlay:
`registerComponent(name, Cls, target?)` / `unregisterComponent` /
`clearVComponents` / `getVRuntime` / `_hasVComp`; API cũ nguyên vẹn.

### 10.6 Sandbox — giới hạn an toàn (đọc kỹ)

`new Function` trong trình duyệt **không phải sandbox bảo mật tuyệt
đối**. Code ở đây chỉ làm 2 lớp rào chắn chống **truy cập nhầm**:

- (a) Quét tĩnh mã nguồn V, chặn identifier bị cấm (`window`,
  `document`, `fetch`, `eval`, `XMLHttpRequest`, `localStorage`,
  `globalThis`, `Function`, `require`, `process`, `WebSocket`,
  `indexedDB`, `navigator`, `location`, `alert`, ...) kèm số dòng.
  `module`/`parent`/`top`/`self` là tên hợp lệ trong V nên không chặn
  ở mã nguồn; lớp (a2) quét mã JS sinh ra sẽ chặn khi chúng là biến
  tự do (biến local cùng tên được miễn vì nó che global).
- (b) Chạy với `'use strict'` và chỉ truyền đúng 3 tham số
  (`VR`, `Math`, `console`).

Code V độc hại vẫn có thể thoát qua các đường khác (ví dụ qua `VR`).
**Chỉ chạy code V từ nguồn bạn tin cậy.**

### 10.7 Giới hạn đã biết (thật, không giấu)

- `scene.instantiate()` trả `null` → `OrbSpawner.start()` thoát sớm
  (log `or`); chưa spawn prefab từ V.
- Component V cần node con (`SlimeHop` cần `Body`, `GolemWalk` cần
  `Hips/...`, `HeroController` cần `Trail`/`Dust`) — cầu nối tạo sẵn
  node con **ảo** (không có mesh) để `find()` không return sớm; hiệu
  ứng squash/stretch/particles ở đó không hiện hình, chỉ logic chạy.
- `SkinnedModel3D` trên hero là stub (`{data: null, ...}`) để
  `HeroController.update` không return sớm; `idle_frame`/clip không
  chạy (VeloPlay vẫn lái animation Thần Điêu bằng `_thandieuSetMode`).
- V `Health` chết/hồi sinh quản lý `node.active` + store; Core hero
  chết/hồi sinh vẫn theo `st.hero` (đồng bộ qua store `hp`).
- V `FollowCamera` chỉ đồng bộ **yaw** về Core (`st.cam.yaw`); vị trí
  camera vẫn theo công thức Core (dist 7.5/height 3.2) với yaw đó.
- Orb V nhặt và orb Core nhặt cùng đếm qua store `orbs` (đồng bộ 2
  chiều) — nếu chạy cả 2 loại OrbPickup cùng lúc có thể đếm trùng;
  nên dùng một bên.
- `Pulse3D` dùng `map[voidptr]Color` thật (Map với key là object).
- Chưa hỗ trợ: `enum`, `match`, `defer`, `select`, `lock`,
  comptime (`$for`/`$if`/`$embed_file`), C interop, concurrency.

### 10.8 Test (2026-11-24)

Harness `~/workspace/.test-mapeditor/test-vcode-runner-mapeditor.js` —
**91/91 PASS × 3 vòng liên tiếp** (coordinator chạy lại 1 vòng: 91/91),
fixture V thật `fixtures/velo/game.v` (637 dòng) + `combat.v`
(654 dòng) tải từ repo Velo: dịch full 2 file 0 lỗi, JS sinh ra pass
`node --check`, chạy đúng trên runtime stub (hero V đi 1s ≈ 4,58m,
dash 0,3s đi 3,44m + cooldown, orb +1 + respawn r 3–16, slime bump
damage 1 + knock 9 + invuln 1s, slash damage 1, bolt speed 16 damage 2
→ slime chết + kills=1, FollowCamera đặt (0,3,−7) + orbit E ≈120°/s,
PathRunner giữ bán kính 10, HealZone hồi 1hp, SpinBob xoay 45°/0,5s);
7 case lỗi (`spawn`/`$for`/C interop…) báo đúng số dòng; 5 case sandbox
bị chặn + 1 case `parent` không chặn nhầm; panel jsdom + THREE thật:
chạy SpinBob qua panel → hero xoay + stop khôi phục map, chạy full
game.v qua panel → HeroController V lái hero bằng W (dz 4,58m) + Core
đồng bộ vị trí.

3 bug thật bắt được khi test đã sửa: `Node.new` đệ quy vô hạn, `.len`
trên ident có chấm không đổi thành `__len`, `add_child` gọi THREE.add
với object thường. Hồi quy cùng ngày: `test-velo-play` 72/72,
`test-velo-prefabs` 62/62, `test-velo-folder` 140/140,
`test-mapeditor` 96/96, `test-velo-mapeditor` 69/69,
`test-fbx-mixamo` 73/73, `test-offline` 93/93.
