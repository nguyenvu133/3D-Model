# Map Editor 3D — Trường Bạch

Map Editor 3D cho PixiJS Studio: sửa map/terrain wuxia tuyết, nối 2 chiều với Studio chính (`index.html`).

## 1. Mở

- Mở `MapEditor.html` trực tiếp, hoặc trong Studio bấm nút **Map Editor** trên topbar.
- Map mặc định: **Trường Bạch** — đền chính trên núi tuyết, 7 nhà dân, cổng thành, cổng dungeon (portal), tượng kiếm hiệp, 42 thông tuyết, 14 đá, cầu gỗ qua hồ băng, thác nước, 10 đèn lồng, 3 lửa trại, hero chibi + boss Long Ngâm + 4 quái, 2 đường patrol, mặt trời + đèn điểm.
- Template khác: nút **Bamboo Forest** (rừng trúc) và **Dungeon** (hầm tối) ở góc trái viewport.

## 2. Cách dùng

| Việc | Cách làm |
|---|---|
| Xoay camera | Kéo chuột trái (orbit), chuột phải/giữa = pan, scroll = zoom |
| Đổi view | Nút Iso / Perspective / Top / Front / Side |
| Chọn object | Click object trong viewport hoặc trong Hierarchy |
| Di chuyển/xoay/scale | Q chọn, W di chuyển, E xoay, R scale (gizmo 3D) hoặc sửa số trong Inspector |
| Focus | F (object đang chọn) · Frame (cả map) |
| Sculpt terrain | Chọn Raise/Lower/Smooth/Flatten/Noise/Mountain, kéo trên terrain. Chỉnh Size/Strength/Falloff |
| Sơn terrain | Tool Paint, chọn layer (Cỏ/Tuyết/Đá/Đất/Cát/Đá phiến/Nước) |
| Rải cây/đá | Tool Scatter, chọn loại, kéo trên terrain |
| Đặt asset | Click thẻ trong Asset Manager rồi click lên terrain, hoặc kéo-thả thẻ vào viewport |
| Patrol path | Chọn object patrol trong Hierarchy → Inspector → "Thêm điểm" → click lên terrain |
| Thời tiết | Panel Environment: preset Tuyết/Nắng/Mây/Đêm/Hoàng hôn, giờ trong ngày, fog, tuyết rơi |
| Play | Space hoặc nút Play: hero/quái đi theo patrol, lửa trại nhấp nháy, portal xoay |
| Undo/Redo | Ctrl+Z / Ctrl+Y (tối đa 40 bước) |
| Lưu | Ctrl+S (localStorage) · Export file `.mapeditor.json` · Import file |
| Thần Điêu | Chọn hero → Inspector → "Load Thần Điêu (FBX)": cần `models/thandieu/thandieu-Mixamo.fbx` trong repo |

Phím tắt: Q/W/E/R tool · F focus · G grid · Ctrl+D duplicate · Ctrl+Z/Y undo/redo · Ctrl+S save · Delete xoá · Space play/pause · Esc huỷ đặt/thoát.

## 3. Nối 2 chiều với Studio (quan trọng)

### Format chung: `pixistudio-shared-scene-1`

```json
{
  "format": "pixistudio-shared-scene-1",
  "name": "Truong Bach", "version": "21.0", "savedAt": "...", "source": "mapeditor",
  "map": {
    "terrain": { "size": 112, "segments": 64, "heights": [float...], "paint": [uint8...] },
    "environment": { "weather": "snow", "sky": 10397273, "fog": {"color":..., "near":60, "far":180}, "sun": {"color":..., "intensity":1.05}, "timeOfDay": 10, "snow": true },
    "objects": [ {"id","type","name","group","position":[x,y,z],"rotation":[x,y,z],"scale":[x,y,z],
                  "color","material","collider":{"shape":"box","size":[...]},"light":{"color","intensity","distance"},
                  "path":[[x,z]...],"anim","url","placeholder","locked","visible"} ]
  },
  "objects": [ /* entry kiểu Studio: {uuid,name,type,locked,visible,position,rotation,scale,isPrimitive,primKind} — chỉ primitive */ ]
}
```

- `map.objects` là nguồn chính cho MapEditor; `objects` là bản tương thích Studio (chỉ primitive khôi phục được qua `Scene.applySerializedObjects`).
- Heights: `(segments+1)²` số, thứ tự hàng z rồi cột x. Paint: layer index / vertex (0=Cỏ, 1=Tuyết, 2=Đá, 3=Đất, 4=Cát, 5=Đá phiến, 6=Nước).

### Cơ chế (3 đường)

1. **localStorage key `pixistudio.sharedScene`** (cùng origin) — đường chính.
2. **URL `?scene=pixistudio.sharedScene`** — mở thẳng scene đã chia sẻ.
3. **File `.shared-scene.json`** — fallback khi khác origin/máy (Export Shared trong MapEditor, Import trong MapEditor; Studio nhận qua shared key).

### MapEditor → Studio

Nút **"Mở trong Studio"** trong MapEditor: serialize map → ghi shared key → mở `index.html?scene=pixistudio.sharedScene&from=mapeditor`. Studio (`js/core/map-link.js`, gọi từ `App.boot` sau `Topbar.init`) đọc key, import terrain (PlaneGeometry + heights + vertex color) và objects (prefab procedural / primitive / light / patrol) vào `Viewport.modelRoot`, đăng ký vào `Scene.registry`, báo notify, rồi **xoá key**. Không có key hoặc key lỗi → Studio chạy bình thường, không crash.

### Studio → MapEditor

Nút **"Map Editor"** trên topbar Studio: `Storage.serializeProject()` → chuyển sang shared doc (giữ lại terrain/environment của map đã import trước đó nếu có — round-trip — và cập nhật transform object theo project) → ghi shared key → mở `MapEditor.html?scene=pixistudio.sharedScene&from=studio`. MapEditor lúc boot đọc key và load scene đó. Object studio không có trong MapEditor (model GLB, kiểu lạ) → **placeholder box** + ghi warning trong notify, không crash. Primitive studio (box/sphere/...) → khôi phục đúng loại.

## 4. Kiến trúc

```
MapEditor.html (shell)
css/map-editor.css
js/mapeditor/
  core/SceneData.js      — model dữ liệu + templates + chuyển đổi shared format
  core/MapEditor.js      — boot, loop, input, undo/redo, CRUD, placement, shortcuts
  link/SharedScene.js    — shared key + ?scene= + project slots + file
  viewport/Viewport3D.js — three r128 thật, orbit rig, gizmo, picking, HUD PixiJS, tuyết, play mode
  viewport/CameraRig.js  — orbit spherical, views iso/perspective/top/front/side
  terrain/TerrainEditor.js — heightmap mesh, heightAt, resize/resample
  terrain/TerrainBrush.js  — sculpt (raise/lower/smooth/flatten/noise/mountain) + paint + scatter
  editor/Hierarchy.js    — cây nhóm/object, search, ẩn/khoá, đổi tên, kéo-thả đổi nhóm
  editor/Inspector.js    — Transform/Material/Light/Collider/Patrol/Animation/mesh stats
  editor/AssetManager.js — thẻ asset + thumbnail canvas 2D + click/kéo-thả đặt
  editor/Placement.js    — prefab wuxia procedural + hero animation
  environment/Environment.js — preset thời tiết, ngày/đêm, fog, tuyết
  export/MapExport.js    — save/load/export/import + openInStudio + checkIncomingShared
js/core/map-link.js      — phía Studio: import shared + serialize studio → shared
```

**Trung thực về PixiJS:** PixiJS là engine 2D nên không render 3D thật. MapEditor dùng **three.js r128** làm viewport 3D thật (cùng phiên bản với Studio để tương thích GLB), còn **PixiJS 8.23.0** làm HUD overlay 2D (FPS/draw calls/tris/objects + minimap chấm object). Nếu PixiJS không load được, HUD DOM dự phòng vẫn hiện số liệu.

## 5. Giới hạn (ghi rõ, không giấu)

- **Không physics thật:** Collider chỉ là dữ liệu (khung vàng khi bật Collision Preview); không có rigidbody, va chạm, NavMesh thật. Đường patrol chỉ để Play mode đi theo, không phải pathfinding.
- **Không sửa vertex/edge/face** của model: nút Mesh Deform trong prompt là **planned** — Inspector chỉ sửa transform/material/light/collider.
- **Bloom chưa làm:** panel ghi rõ Planned. Tone mapping (ACES) + fog là thật.
- **FBX:** chỉ load được khi có file trong repo + mạng CDN (FBXLoader/fflate). GLB import qua Asset Manager cần GLTFLoader (đã có CDN).
- **Chưa test trên điện thoại thật** — layout desktop 1920×1080, có responsive thu gọn panel ở <1100px.
- **Autosave** 60 giây vào `mapeditor.autosave` (chỉ lưu khi có thay đổi).
- **Shared key** chỉ hoạt động cùng origin (cùng host/cổng). Khác máy thì dùng file `.shared-scene.json`.

## 6. Test

Harness `~/workspace/.test-mapeditor/test-mapeditor.js` (jsdom + three r128 thật + WebGLRenderer stub + PIXI stub):

- Boot, default scene đủ object (terrain + đền + nhà + thông + hero + patrol)
- Terrain brush đổi heightmap thật, paint đổi vertex color
- Place/duplicate/delete, hierarchy phản ánh scene, inspector sửa transform
- Save/load JSON round-trip (map → studio format → map)
- Shared-key hand-off 2 chiều (MapEditor → map-link import vào studio giả; studio → MapEditor)
- Undo/redo, phím tắt
- `node --check` mọi file JS mới/sửa; server smoke 200; hồi quy `test-fbx-mixamo.js` 73/73

Kết quả (đã chạy, 2026-11-24):

- `~/workspace/.test-mapeditor/test-mapeditor.js`: **96/96 PASS × 2 vòng** (vòng 1: 94/96 — 2 lỗi: 1 lỗi test đo sai trục xoay tay hero, 1 thiếu warning cho object placeholder; đã sửa code + test, vòng 2: 96/96).
- `node --check`: **15/15 OK** (13 file `js/mapeditor/`, `js/core/map-link.js`, `js/core/app.js`).
- Server smoke: **18/18 file trả 200** (MapEditor.html, css, 13 js mapeditor, map-link.js, index.html, app.js).
- Hồi quy studio cũ: `test-fbx-mixamo.js` **73/73 PASS** (exporter không bị ảnh hưởng).

## 7. Auto-update + mở rộng Map Editor (v2, 2026-11-24)

### 7.1 Auto-update trung tâm

- `MapEditor.emitChange(kind, detail)` — mọi mutation (add/delete/rename/reparent/select/undo/redo/load/import) đi qua đây; debounce ~80ms rồi refresh **Hierarchy + Inspector + AssetManager + HUD minimap + panel thống kê** cùng lúc. `emitChangeNow()` cho load/undo cần cập nhật ngay. Kind `'live'` (kéo slider, sửa số) không render lại Inspector để khỏi mất focus. `select()` vẫn render ngay (không qua debounce).
- **AssetManager registry thật**: `registerAsset(asset)` / `unregisterAsset(id)` / `getAsset(id)` / `listAssets()` — asset `{id, name, kind, source, veloId?}` gồm prefab built-in (24 thẻ: 21 cũ + torii/tower/well) + file import + asset Velo (agent Velo gọi `registerAsset` là chạy — đã test với asset `velo:d3a10003`). Thêm/xoá asset là panel tự hiện, kèm đếm `N / tổng assets`, tìm kiếm + lọc theo loại nối vào registry thật (lọc `Velo` theo `source`, `Model nhập` theo `kind`).
- **Import file nhận biết định dạng**: nút Import — `.shared-scene.json` → `MapExport.importSharedFile`, `.mapeditor.json` → `MapExport.importFile`, `.glb/.gltf/.fbx/.obj` → `AssetManager.importModelFile` (chỉ gọi hàm có sẵn, không sửa `MapExport.js`).

### 7.2 Mở rộng Map Editor (đều là nút thật)

| Tính năng | Cách dùng |
|---|---|
| Multi-select | Shift/Ctrl+click (viewport + Hierarchy), Shift+kéo khung chọn trong viewport, Ctrl+A chọn hết |
| Copy/paste | Ctrl+C / Ctrl+V (nút trong panel Chỉnh sửa) — paste đổi tên `_paste`, lệch +2m |
| Align / distribute | Align X/Z (min/giữa/max), đều khoảng cách X/Z (cần ≥3 object) — panel Chỉnh sửa |
| Snap | Lưới 0.5/1/2 m + góc 15°/45° — panel Snap; áp vào gizmo (`translationSnap`/`rotationSnap`) + điểm đặt object |
| Camera bookmarks | 5 vị trí, Lưu/Đi — panel Bookmarks, lưu `localStorage` (`mapeditor.bookmarks`) |
| Layers | Environment/Buildings/Props/Characters/Effects (Effects = Lighting + Particles) — ẩn/hiện từng layer |
| Groups | Chọn nhiều object → "Gom nhóm…" (nhóm mới tự tạo, Hierarchy hiện nhóm) |
| Đo khoảng cách | Nút Đo → click 2 điểm trên terrain, hiện số mét + vẽ đường vàng |
| Duplicate dọc path | Chọn 1 object → nhân dọc patrol path gần nhất (4 bản với path mặc định) |
| Scatter có seed | Seed cố định → cùng vị trí rải (test: seed 42 cho cùng toạ độ 2 lần) |
| Terrain brush mới | Plateau (chỉ nâng lên mặt bằng), Terrace (bậc thang 1m), Erode (xói mòn) — nút trong panel Terrain thêm |
| Heightmap | Export/import JSON `mapeditor-heightmap-1` (heights + paint + mực nước), validate độ dài |
| Mực nước | Slider −2…4 m + checkbox — mặt phẳng nước trong suốt, lưu vào `terrain.waterLevel` (đi qua shared format) |
| Prefab wuxia mới | Cổng torii, giếng đá, tháp canh (3 tầng mái) — có trong Asset Manager + `TYPE_GROUP` + thumbnail + icon Hierarchy |
| Bầu trời + fog | Preset mới: Bình minh, Bão tố, Sương mù dày (ô Thời tiết) + preset fog: Sương mỏng/Mặc định/Sương dày |
| Play | Hero cũng đi patrol khi Play (như quái/boss) + checkbox "Camera theo hero khi Play" |
| Scene stats | Panel Đo & Thống kê: objects/verts/tris tổng + theo loại, lấy từ mesh thật |
| Minimap click | Click lên minimap (góc phải trên) → camera di chuyển tới điểm đó |
| Import GLB/FBX/OBJ | Nút "＋ Import GLB / FBX / OBJ" trong Asset Manager (GLTFLoader/FBXLoader có sẵn; OBJLoader tải động từ CDN khi cần). Model đã import đặt được bằng click thẻ/kéo-thả; sau reload trang mà chưa import lại thì hiện placeholder box. Import lưu `url: 'import:<id>'` trong data object |
| Search | Hierarchy tìm theo tên/loại/nhóm; Asset Manager tìm theo tên/loại nối registry |

### 7.3 Inspector — khối "Thông tin" (đầu Inspector)

Tên, loại, đường dẫn trong scene (`Scene / <nhóm> / <tên>`), parent (`Scene (MapRoot)`), số con (trực tiếp/descendant/mesh), transform local + world (position/rotation°/scale — world lấy từ `matrixWorld` thật), mesh (verts/tris/bounds size/skinned), material (số material, màu, roughness/metalness/opacity của material đầu tiên), components (suy từ data + userData thật: Transform/Mesh/PointLight/Collider/PatrolPath/Animation/Light/ImportedModel/VeloAsset/SkinnedMesh), nguồn asset (prefab procedural / file import + tên file / Velo asset ID nếu có), prefab link (tên + `builtin:<type>`), collider (dạng/kích thước), patrol waypoints (số điểm + toạ độ), animation (clip đang chạy — FBX Thần Điêu thì ghi tên clip + số clip; procedural thì ghi tốc độ 1.0x). Khi không chọn object, panel Scene cũng hiện tổng verts/tris + mực nước.

### 7.4 PLANNED (chưa làm, không có nút giả)

- Mesh Deform (sửa vertex/edge/face) — như cũ, vẫn planned.
- Bloom (EffectComposer) — như cũ, vẫn planned.
- NavMesh/pathfinding thật, physics/rigidbody thật — collider + patrol vẫn chỉ là dữ liệu.
- FBX import qua Asset Manager cần file + CDN (đã có loader, chưa test file thật ngoài stub).
- Chưa test trên điện thoại thật.

### 7.5 Test v2

Harness mới `~/workspace/.test-mapeditor/test-mapeditor-v2.js` (jsdom + three r128 thật, cùng stub như harness cũ):

- Registry: 24 built-in, register/unregister Velo, lọc Velo/tìm torii
- emitChange: place/delete → Hierarchy rows + Asset cards + stats panel đổi đúng số (sau debounce 150ms)
- Inspector info đủ 9 trường (temple/patrol/hero)
- Multi-select/copy-paste/align/distribute/snap/bookmarks/layers/nhóm
- Prefab mới, brush Plateau/Terrace/Erode, scatter seed 42 trùng vị trí, heightmap export/import, mực nước
- Đo 3-4-5 = 5m, minimap click, duplicate dọc path (4 bản), marquee chọn đền
- Stats thật, play follow hero, import model (reject .txt, đặt clone model đã load)
- Shared format giữ `veloId` + `waterLevel`, validate sạch

Kết quả (2026-11-24): **`test-mapeditor-v2.js`: 96/96 PASS** · `node --check`: **11/11 OK** (11 file sửa) · Harness cũ `test-mapeditor.js`: **95/96** — 1 FAIL duy nhất là `ghi shared key`: `SharedScene.write()` đã được agent song song đổi sang trả `{ok:true}` thay vì `true` nên assert cũ `=== true` trượt; bản thân write vẫn chạy (test "đọc lại shared key" ngay sau đó PASS). File `SharedScene.js` không thuộc phạm vi sửa của đợt này nên không động vào.

---

## 8. Sửa layout, kết nối, camera (2026-11-24 — sau push 16962a20, chưa push)

### 8.1 Layout: Inspector hiện lại + thanh cuộn rõ (lỗi user báo #3, #6)

Root cause: `#me-right` là column flex không có overflow riêng; các section cố định (Environment ≤220px, Terrain không giới hạn, Velo ≤340px, stats) vượt chiều cao main-row → Inspector body (`flex:1; min-height:0`) co về 0 → không nhìn thấy gì.

Sửa:
- Mọi section trong `#me-right`/`#me-left` thành **collapsible** (bấm `.panel-head` để thu/mở, mũi tên ▾/▸; click vào input/select/button không thu). Terrain, Environment, Velo, Stats **mặc định thu gọn** lần mở đầu; Inspector và Hierarchy luôn mở. Trạng thái lưu `localStorage: mapeditor.panels`.
- `#me-right` có `overflow-y:auto` (fallback); mỗi `.panel-body` có `max-height` (mặc định ≤320px) + `overflow-y:auto`; **Inspector body `flex:1 1 220px`, `min-height:220px` — không bao giờ co về 0**.
- Thanh cuộn hiện rõ: `scrollbar-width: thin; scrollbar-color: #3a4a6a rgba(255,255,255,0.05)` + webkit track nền sáng + thumb `#3a4a6a` (hover `#55648c`) cho mọi `.panel-body`, `#me-right`, `#me-left`, `.me-section-body`.
- **Điện thoại (<700px)**: 2 panel thành drawer trượt (`position:fixed`, trái `translateX(-105%)`, phải `translateX(105%)`, rộng `min(300px,86vw)`); nút ☰ trái/phải trong toolbar mở/đóng; bấm ra ngoài viewport hoặc Esc thì đóng; mở drawer phải thì Inspector tự mở. Viewport full width; `#me-bottom` (Asset strip) thu gọn còn 34px (bấm head để mở).
- **Studio**: `.topbar-actions` có `overflow-x:auto` trên màn hẹp (css/responsive.css) nên nút Map Editor không bị tràn khỏi màn hình nữa.

### 8.2 Kết nối Studio ↔ MapEditor (lỗi user báo #1)

- `MapLink.openMapEditor()`: toast "Đang mở Map Editor…" trước khi navigate; nếu `SharedScene.write` lỗi → tải file JSON như cũ **+ hiện panel hướng dẫn** 3 bước với nút "Mở Map Editor ngay" (navigate `MapEditor.html?import=shared` để MapEditor tự nhắc Import file).
- Menu: topbar workspace nav có thêm mục **Map Editor** (ngoài nút topbar cũ); chọn thì mở Map Editor, lỗi thì notify rõ tiếng Việt.
- Nút **"← Studio"** to rõ trong `#me-topbar` của MapEditor (gọi `openInStudio`).
- Chỉ báo trạng thái: MapEditor topbar hiện **"Đã nối Studio ✓"** khi có `?from=studio`; Studio sau khi import xong hiện toast + statusbar "Đã nhận map từ Map Editor: <tên> (<số> objects)".
- Binding chắc chắn: `MapLink` bind nút ngay khi DOM sẵn (DOMContentLoaded), không đợi `App.boot` xong; nút bấm khi thiếu module thì báo lỗi tiếng Việt.
- MapEditor mở với `?import=shared` → panel "Import file Shared JSON từ Studio" với nút chọn file.

### 8.3 Camera thống nhất 2 chiều (lỗi user báo #2)

#### Bảng tính năng camera

| Tính năng | Studio (OrbitCam) | Map Editor (CameraRig) |
|---|---|---|
| Orbit / Pan / Zoom | có (damping 12%/frame) | có (damping 12%/frame — mới) |
| Persp / Ortho | có (4 camera ortho) | có (Ortho toggle + fit frustum — mới) |
| FOV slider 30–90° | fov từ preset | có (chỉ Persp — mới) |
| View presets | perspective/ortho/front/back/left/right/top/bottom + **iso (mới)** | iso/perspective/top/bottom/front/back/left/right/side |
| Focus-fit (Box3) | `maxDim/(2·tan(fov/2))·1.35` | cùng công thức (mới) |
| Frame All | **có (mới, nút + phím F)** | có (F / nút Frame) |
| Bookmarks | **5 bookmark, localStorage, Alt+1–5 nhảy / Alt+Shift+1–5 lưu (mới)** | 5 bookmark, phím 1–5 nhảy / Shift+1–5 lưu |
| Gizmo | Q/W/E/R | Q/W/E/R |

- MapEditor học Studio: chế độ Ortho (OrthographicCamera riêng, frustum fit theo kích thước map), FOV slider 30–90° trong `#me-viewbar` (disable khi Ortho), damping mượt (desired state `dTheta/dPhi/dRadius/dTarget`, lerp `k = 1 − 0.0009^dt` như OrbitCam), view back/left/right/bottom + preset iso có target, focus-fit dùng đúng công thức fov của Studio.
- Studio học MapEditor: view preset iso, nút Frame All (phím F, nút `#vp-frame-btn` trong `#viewport-topbar`, mục trong vp-menu), 5 camera bookmarks (localStorage `pixistudio.bookmarks`).
- Phím tắt chung: F = frame all; Q/W/E/R = gizmo; 1–5 = bookmark (MapEditor), Alt+1–5 = bookmark (Studio — tránh xung đột với phím 1–8 đổi view của Studio).

### 8.4 Test (harness mới)

`~/workspace/.test-mapeditor/test-velo-folder-mapeditor.js` — xem docs/VELO_INTEGRATION.md §8 và kết quả trong §8.5 dưới. Hồi quy: `test-mapeditor.js` 96/96, `test-velo-mapeditor.js` 69/69, `test-fbx-mixamo.js` 73/73.

### 8.5 Kết quả test (2026-11-24)

Harness mới `~/workspace/.test-mapeditor/test-velo-folder-mapeditor.js` (jsdom + three r128 thật, fixture thư mục Velo trong `~/workspace/.test-mapeditor/fixtures/velo-folder/`): **140/140 PASS × 2 vòng** (vòng 1 và vòng 2 giống nhau). Hồi quy cùng ngày: `test-mapeditor.js` 96/96, `test-velo-mapeditor.js` 69/69, `test-fbx-mixamo.js` 73/73. `node --check`: 15/15 file JS mới/sửa OK. Server smoke: 13/13 file 200.

Trong quá trình viết harness đã bắt được 3 bug thật trong code mới và đã sửa: (1) `scanFiles` không đọc `f._relPath` nên file từ `showDirectoryPicker` mất đường dẫn thư mục; (2) `getUnsavedModelAssets` append `.fbx` cả khi tên đã có đuôi `.glb`; (3) nút "Scene đã đổi — Tải lại" không có `id` nên test/code khác không tìm được. Ngoài ra hook cây project vào `AssetManager.render` để cây tự cập nhật khi import model trong phiên.

## 9. Object mới + "Lấp đầy map" (2026-11-24 — chưa push)

### 9.1 35 prefab procedural mới

Thêm vào `Placement.BUILDERS` + `ASSET_LIST` (đăng ký sẵn trong Asset Manager, có thumbnail canvas riêng — xem `AssetManager.drawThumb`). Danh sách đầy đủ trong `Placement.NEW_TYPES` (35 loại):

| Prefab mới | Mô tả ngắn | Nhóm |
|---|---|---|
| `pagoda` | Chùa 3 tầng mái cong, đế đá 2 bậc, đỉnh vàng | Buildings |
| `torii_big` | Cổng torii đỏ lớn (~1.6× torii thường) | Buildings |
| `house_tile` | Nhà mái ngói cong xanh | Buildings |
| `house_thatch` | Nhà mái rơm vàng | Buildings |
| `house_flat` | Nhà mái bằng 2 tầng + ống khói | Buildings |
| `stall` | Quầy hàng chợ, mái vải sọc + hàng hoá | Buildings |
| `pine_snow` | Thông tuyết dày | Vegetation |
| `pine_tall` | Thông cao 4 tầng tán | Vegetation |
| `pine_short` | Thông lùn 2 tầng tán | Vegetation |
| `sakura` | Hoa anh đào (cụm hoa hồng) | Vegetation |
| `mushroom` | Nấm mũ đỏ chấm trắng | Vegetation |
| `lantern_red` / `lantern_yellow` / `lantern_blue` | Đèn lồng 3 màu (đỏ/vàng/xanh) | Props |
| `bridge_arch` | Cầu gỗ cong (vòm) | Props |
| `well_stone` | Giếng đá có mái ngói, 4 cột | Props |
| `fence_wood` | Hàng rào gỗ dài, cọc nhọn | Props |
| `statue_dragon` | Tượng rồng đá uốn lượn + sừng vàng | Props |
| `crystal_red` / `crystal_blue` / `crystal_purple` | Tinh thể 3 màu (phát sáng) | Props |
| `stone_stove` | Bếp lửa đá (vòng đá + lửa + nồi) | Props |
| `stream` | Suối (dải nước trong + đá 2 bờ) | Props |
| `cloud` | Mây bay (trôi trong Play mode) | Props |
| `chest` | Rương kho báu (nắp vòm + viền vàng) | Props |
| `coin` | Xu vàng đứng | Props |
| `banner` | Cờ / băng rôn đỏ + huy hiệu vàng | Props |
| `stone_steps` | Bậc đá 4 bậc | Props |
| `stone_path` | Đường đá 5 phiến | Props |
| `bird` | Chim bay (cánh đập trong Play mode) | Characters |
| `bat` | Dơi bay (cánh đập, mắt đỏ) | Characters |
| `wolf` | Sói 4 chân, tai nhọn, đuôi | Characters |
| `villager_blue` / `villager_red` / `villager_yellow` | Dân làng NPC 3 kiểu áo | Characters |

Animation Play mode (`Viewport3D.updatePlay`): chim/dơi đập cánh qua `Placement.animateFlying` (cánh xoay sin, bay lượn quanh độ cao gốc); mây trôi chậm theo +x, quay lại đầu map khi ra biên; bếp đá cháy như lửa trại (ngọn lửa `flame` co giãn).

### 9.2 Nút "🌲 Lấp đầy map"

Thêm bằng JS vào `#me-toolbar` (`MapEditor._buildFillMapUI`, không sửa MapEditor.html): 1 select preset + 1 ô nhập seed + nút **"🌲 Lấp đầy map"**. Bấm 1 lần rải cả preset lên map hiện tại; `MapEditor.fillMap(preset, seed)` báo rõ bằng notify: `Preset "<tên>" (seed <số>): +<N> object — <trước> → <sau> object · Draw ~<calls> · Tris ~<số>`.

4 preset scatter (`TerrainBrush.PRESETS`, mỗi preset là danh sách zone `{type, count, cx, cz, r, sMin, sMax}`) + preset `full` = Rừng + Làng:

| Preset | Seed mặc định | Nội dung | Số object thêm |
|---|---|---|---|
| `full` — 🌲 Rừng + Làng | 20261124 | Rừng + Làng gộp lại (đầy đủ nhất) | ~114 |
| `forest` — 🌲 Rừng | 11 | Thông 3 kiểu, anh đào, nấm, trúc, đá | 66 |
| `village` — 🏠 Làng | 22 | Nhà 3 kiểu, giếng, hàng rào, đèn, dân làng, cờ, chùa | 48 |
| `market` — 🏪 Chợ | 33 | Quầy hàng, đèn, rương, xu, dân làng, cờ | 38 |
| `battlefield` — ⚔️ Chiến trường | 44 | Sói, quái, boss, dơi, đá, bếp lửa, cờ | 32 |

**Deterministic:** mỗi preset dùng RNG `mulberry32(seed)` riêng, không dùng `Math.random`; vị trí/quay/scale được làm tròn 2 chữ số thập phân rồi đặt qua `MapEditor.placeObjectsBulk` (1 undo + 1 emit cho cả lần fill — undo 1 lần hoàn tác cả lần fill). Cùng seed + cùng map → cùng số object và cùng vị trí (harness kiểm tra snapshot đã sắp xếp giống nhau tuyệt đối).

### 9.3 Map mặc định Trường Bạch: 91 → 179 object

`SceneData.defaultObjects()` thêm 88 object mới (làng 6 nhà 3 kiểu + 4 quầy chợ + giếng đá + hàng rào + đèn 3 màu, rừng 14 thông mới + 4 anh đào + 4 nấm, 3 tinh thể, bếp đá, suối, cầu cong, mây, chim, dơi, sói, 6 dân làng, 2 rương, 4 xu, cờ, bậc đá, đường đá, chùa, torii lớn, tượng rồng) — chứa đủ 35/35 loại prefab mới. Vị trí random dùng chung `mulberry32(20261124)` nên map mặc định vẫn xác định mỗi lần load; `validate()` không lỗi, không trùng id.

**Hiệu năng:** `Placement.mat()` cache material theo màu + opts (dùng chung thay vì new material mỗi mesh); `buildPrefab` clone material trước khi đổi màu/roughness riêng nên tuỳ chỉnh không rò sang object khác. `Viewport3D.computeStats()` đếm thật từ scene (mỗi mesh = 1 draw call): map mặc định 179 object → **~993 draw calls, ~90.682 tris, 993 mesh** (đo trong harness). Con số này là ước tính trên, vì renderer thật có thể gộp/frustum-cull bớt; nếu máy yếu thì giảm object bằng cách xoá bớt cây trong Hierarchy hoặc dùng preset nhỏ hơn.

### 9.4 Test

Harness mới `~/workspace/.test-mapeditor/test-velo-prefabs-mapeditor.js` (jsdom + three r128 thật, boot giống `test-velo-folder-mapeditor.js`): **62/62 PASS × 2 vòng**. Nội dung: (a) 35 builder đều trả `THREE.Group` ≥1 mesh + `userData.mapType` đúng, material dùng chung qua cache, color override không rò; (b) fill deterministic (cùng seed → cùng số object + cùng snapshot vị trí; seed khác → vị trí khác), 4 preset đúng loại (Rừng ≥80% cây, Làng có nhà + dân làng, Chợ có quầy + xu, Chiến trường có quái), click nút thật trên toolbar tăng object, preset lạ báo lỗi không crash, undo 1 lần hoàn tác cả lần fill; (c) map mặc định 179 object ≥150, `validate()` sạch, không trùng id, chứa đủ 35/35 loại mới; (d) AssetManager đăng ký đủ 35 prefab mới, grid 59 thẻ đều có canvas thumbnail; (e) Play mode: chim đập cánh (biên độ 0.648), mây trôi; (f) export Velo: `cone`/`sphere`/`plane`/`cylinder` + `PointLight3D` + `validate()` ok. Hồi quy cùng ngày: `test-velo-folder-mapeditor.js` 140/140, `test-mapeditor.js` 96/96, `test-velo-mapeditor.js` 69/69, `test-fbx-mixamo.js` 73/73. `node --check`: 7/7 file JS mới/sửa OK. Server smoke: 11/11 file 200.

Trong quá trình viết harness đã bắt được 1 lỗi test (không phải lỗi code): đo cánh chim đúng lúc sin qua 0 nên đọc 0.000 → đã sửa test đo biên độ max qua 6 bước (0.648).

### 8.6 Run Velo — chơi game demo3d trong trình duyệt (2026-11-24)

Nút **▶ Run Velo** trên toolbar (hoặc phím **R** khi đã import scene Velo) chạy game
demo3d ngay trong trình duyệt — **bản port JS chạy bằng three.js, KHÔNG chạy engine V,
KHÔNG biên dịch code V** (logic file `.v` chỉ được đọc để port các con số/quy tắc).

- Luật port từ `game.v`/`combat.v` (`js/mapeditor/velo/VeloPlay.js`, `VeloPlay.Core`):
  Hero speed 5, dash 12/0.3s/cd 0.7s, arena 24m, clip_speed 3.6, autopilot sau 5s
  không nhập liệu (tự chạy tới orb gần nhất, orb xa >9m thì dash, 2%/frame);
  FollowCamera distance 7.5/height 3.2/smoothing 6, orbit Q/E 120°/s, kéo chuột
  0.3°/px; SlimeHop/DroneHover/DroneGun/GolemWalk/GolemSlam; OrbSpawner 10 orb,
  nhặt +1, respawn ngẫu nhiên r 3–16; HP hero 8/enemy 3, invuln 1s/0.15s, chết
  hồi sinh sau 2s/6s, hero chết reset orbs về 0, enemy chết +1 kills; slash
  damage 1/range 2.4/arc 120°/cd 0.4s (J hoặc click chuột, click <6px mới tính),
  bolt damage 2/speed 16/cd 0.7s (K); HealZone 1 HP/s; thắng khi nhặt 20 orb.
- Điều khiển: WASD/mũi tên + J/K/Shift/Space/Q/E + click chém; **điện thoại:
  joystick ảo trái + nút Dash/Chém/Phép phải** (kiểu joystick + CSS của WUXIA3D.js),
  camera follow + orbit bằng kéo 1 ngón. Âm thanh WebAudio beep (pattern AudioMan
  của WUXIA3D.js, không cần file âm thanh): nhặt orb / chém trúng / bị đánh / thắng.
- Khi chơi: editor UI thu gọn (class `velo-playing` trên body — ẩn 2 panel +
  bottom + viewbar), hiện HUD game (Orbs, thanh HP, Defeated, FPS/draws/tris,
  dòng Help đúng như HUD Velo). Bấm **Esc** hoặc nút **⏹ Dừng** → về editor,
  khôi phục vị trí/trạng thái scene trước khi chạy (snapshot + `resetPlayState`) —
  **không làm mất map đang sửa**. Kỷ lục (orbs max, kills) lưu localStorage
  `velo-play-best`, hiện khi thắng/chết.
- Giới hạn (PLANNED, chưa có): Trail3D/Particles3D thật (orb nổ/bụi chân hiện
  là sphere flash đơn giản + âm thanh, chưa có hệ hạt); thanh HP 3D là plane
  billboard đơn giản; autopilot dash dùng xác suất 2%/frame như gốc nên không
  hoàn toàn xác định; tốc độ chạy của runner lấy từ PathRunner trong scene.
- Test: `~/workspace/.test-mapeditor/test-velo-play-mapeditor.js` — **72/72 PASS × 2 vòng**
  (2026-11-24). Hồi quy cùng ngày: `test-velo-folder-mapeditor.js` 140/140,
  `test-mapeditor.js` 96/96, `test-velo-mapeditor.js` 69/69, `test-fbx-mixamo.js` 73/73.

## 10. Chế độ Offline + vendor thư viện (2026-11-24 — chưa push)

### 10.1 File vendor trong `js/vendor/` (tải từ jsdelivr)

| File | Phiên bản / nguồn | Byte thực tế |
|---|---|---|
| `three.min.js` | three@0.128.0/build/three.min.js | 603.445 |
| `pixi.min.js` | pixi.js@8.23.0/dist/pixi.min.js | 912.519 |
| `GLTFLoader.js` | three@0.128.0/examples/js/loaders/GLTFLoader.js | 96.550 |
| `TransformControls.js` | three@0.128.0/examples/js/controls/TransformControls.js | 45.539 |
| `fflate.js` | fflate@0.6.10/umd/index.js | 29.679 |
| `FBXLoader.js` | three@0.128.0/examples/js/loaders/FBXLoader.js | 100.686 |
| **Tổng** | | **1.788.418 (~1,79 MB)** |

Kích thước khớp đúng từng byte. Cả 6 file là text UTF-8 (0 byte NUL,
`file` → JavaScript/ASCII text), `node --check` OK — **đẩy được lên
GitHub bằng snapshot push text**, không phải binary. Xem thêm
`js/vendor/README.md`.

`MapEditor.html` tải 6 file local này làm nguồn chính, giữ nguyên thứ tự
cũ (three → pixi → GLTFLoader → TransformControls → fflate → FBXLoader);
khi file local lỗi mới fallback jsdelivr → unpkg qua helper
`window.__meLibFallback` (chỉ chạy khi có mạng). Lúc khởi động, khối
script kiểm tra trong `MapEditor.html` sẽ báo rõ tên file thiếu + hướng
dẫn (banner đỏ + statusbar) thay vì để trang trắng lặng lẽ.

### 10.2 Cách mở offline trên điện thoại

1. Tải ZIP repo 1 lần (lúc còn mạng): mở repo GitHub → **Code → Download ZIP**
   (hoặc `git clone` trên máy tính rồi copy thư mục qua điện thoại).
2. Giải nén ZIP trên điện thoại (app Files / ZArchiver…).
3. **Tắt WiFi + dữ liệu di động** (để kiểm tra thật là offline).
4. Mở app **Chrome** → gõ vào thanh địa chỉ
   `file:///sdcard/Download/3D-Model-main/MapEditor.html`
   (đường dẫn tuỳ chỗ bạn giải nén) → Enter. Hoặc mở từ app Files:
   chọn file `MapEditor.html` → **Mở bằng Chrome**.
5. Map, viewport 3D, terrain, prefab, Inspector… chạy bình thường vì
   thư viện đã nằm sẵn trong `js/vendor/`.

Lưu ý: mở qua `file://` thì trình duyệt chặn `fetch()` tới file local —
`OfflineMode.js` + guard trong `VeloImport.js` đã xử lý (bỏ qua bước
kiểm tra HEAD file local, không báo lỗi giả).

### 10.3 Nút nào dùng được offline / nút nào cần mạng

Badge trên toolbar (góc phải thanh công cụ) hiện **● Offline** khi mất
mạng hoặc khi mở qua `file://`, **● Online** khi có mạng (tự cập nhật
khi bật/tắt mạng, `js/mapeditor/core/OfflineMode.js` tự init).

| Chức năng | Offline | Ghi chú |
|---|---|---|
| Viewport 3D, camera, terrain, đặt/xoá object, Inspector, Hierarchy | ✅ | Chạy local hoàn toàn |
| Play (chế độ chơi cơ bản trong MapEditor) | ✅ | Local |
| Export `.scene` / tải `main.scene`, `.meta`, tải tất cả | ✅ | Tải file bằng Blob, không cần mạng |
| Mở thư mục project Velo (chọn thư mục trên máy) | ✅ | Đọc file local |
| **📂 Mở .scene từ máy (offline)** — khối "📴 Offline" trong panel Velo | ✅ | FileReader, gọi `VeloImport.importFile` |
| **📂 Mở .fbx Thần Điêu từ máy (offline)** — khối "📴 Offline" trong panel Velo | ✅ | FileReader, gọi `VeloImport.loadHeroFBXFromBuffer` (qua `VeloPanel.onHeroFileChosen` nếu có) |
| Chọn file `.scene` / `.fbx` có sẵn trong panel Velo | ✅ | Local, vẫn mở khi offline |
| V Code Runner (dịch V→JS, xem VELO_INTEGRATION.md §10) | ✅ | Dịch + chạy đều local |
| ⬇ Import demo3d Velo (tải `main.scene` từ GitHub) | ❌ | **Bị khoá khi offline** (nút mờ + tooltip "Cần mạng…"); `importDemo3d` cũng bị chặn sớm với thông báo rõ |
| Tải FBX Thần Điêu từ GitHub raw (bước 2 chuỗi load Hero) | ❌ | Cần mạng — thay bằng nút chọn file `.fbx` offline ở trên |
| Fetch prefab `.scene` gốc từ GitHub (`VeloPrefabLibrary`) | ❌ | Cần mạng — dùng prefab fallback nhúng sẵn / prefab trong thư mục project |
| Run Velo (bản port JS) | ✅* | Chạy bằng JS local; *chỉ cần Hero FBX: lấy từ file `.fbx` offline hoặc đã có sẵn trong thư mục project |

### 10.4 File sửa/tạo (chưa push)

- Mới: `js/vendor/` — 6 file thư viện + `README.md`.
- Mới: `js/mapeditor/core/OfflineMode.js` (~13,6 KB) — badge, khoá nút mạng,
  khối picker offline, chặn sớm `importDemo3d`; tự init, không cần sửa `MapEditor.js`.
- Sửa: `MapEditor.html` — 6 script tag sang local + fallback CDN, script kiểm
  tra thư viện lúc khởi động, span badge `#me-offline-badge` trên toolbar,
  thêm script tag `OfflineMode.js` trước `MapEditor.js`.
- Sửa tối thiểu: `js/mapeditor/velo/VeloImport.js` — chỉ thêm guard
  `location.protocol === 'file:'` ở bước (3) chuỗi load FBX: bỏ qua
  `fetch HEAD` file local khi chạy `file://` (Chrome chặn fetch file local).

Không đụng: `index.html` (Studio), `VeloPanel.js`, `VeloPlay.js`,
`VCodeRunner.js`, `docs/*.md` (phần V Code ở VELO_INTEGRATION.md §10).

### 10.5 Test (2026-11-24)

Harness `~/workspace/.test-mapeditor/test-offline-mapeditor.js` —
**93/93 PASS × 2 vòng** (coordinator chạy lại 1 vòng: 93/93): vendor tồn
tại + đúng kích thước (lệch thực tế 0) + UTF-8 + header, `MapEditor.html`
trỏ local + còn fallback CDN, badge + hàm khoá nút mạng, guard `file://`
trong `VeloImport.js`, server smoke 200 cho 6 file vendor +
`MapEditor.html` + `OfflineMode.js`.

**Lỗi hồi quy bắt được khi gộp (đã sửa, không phải lỗi code chạy):**
thêm 2 khối `<script>` inline vào `MapEditor.html` (lib-fallback +
lib-check) làm 5 harness cũ crash `SyntaxError: Unexpected token '<'` —
regex cũ trong harness lấy khối inline **đầu tiên** tới `</body>` nên
nuốt cả các `<script src>` ở giữa. Đã sửa cả 5 harness
(`test-mapeditor.js`, `test-velo-mapeditor.js`,
`test-velo-folder-mapeditor.js`, `test-velo-play-mapeditor.js`,
`test-velo-prefabs-mapeditor.js`) sang lấy khối inline **cuối cùng**
(scene tabs + boot). Sau sửa, hồi quy: `test-velo-play` 72/72,
`test-velo-prefabs` 62/62, `test-velo-folder` 140/140,
`test-mapeditor` 96/96, `test-velo-mapeditor` 69/69,
`test-fbx-mixamo` 73/73, `test-vcode-runner` 91/91.
