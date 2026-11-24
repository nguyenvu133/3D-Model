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
