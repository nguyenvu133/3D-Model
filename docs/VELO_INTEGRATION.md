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
