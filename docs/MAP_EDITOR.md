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
