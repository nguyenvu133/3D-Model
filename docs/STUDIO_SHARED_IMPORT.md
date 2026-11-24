# Import Shared Scene giữa Map Editor ↔ Studio

Tài liệu cho flow chia sẻ scene qua **shared key localStorage** và **file
`.shared-scene.json` (fallback)**. Format: `pixistudio-shared-scene-1`
(`SceneData.toShared` / `fromShared`, xem `docs/MAP_EDITOR.md` §3).

## Tóm tắt

| Hướng | Đường chính | Khi shared key ghi thất bại |
|---|---|---|
| Map Editor → Studio | `Mở trong Studio` ghi key `pixistudio.sharedScene`, mở `index.html?scene=pixistudio.sharedScene&from=mapeditor` | **Tự tải** `<tên-map>.shared-scene.json` + panel hướng dẫn 3 bước + nút `Đã tải xong — Mở Studio` (mở `index.html` không cần key) → trong Studio bấm **`Import Shared JSON`** trên topbar |
| Studio → Map Editor | `Map Editor` ghi key, mở `MapEditor.html?scene=pixistudio.sharedScene&from=studio` | **Tự tải** `studio-map.shared-scene.json` + notify hướng dẫn → trong Map Editor bấm nút **Import** sẵn có (nhận `.shared-scene.json`) |

## Flow chi tiết — Map Editor → Studio

### Đường chính (shared key ghi được)
1. Trong Map Editor, bấm **🏛 Mở trong Studio** (`#me-studio-btn` →
   `MapExport.openInStudio()`).
2. `SharedScene.write(doc)` trả `{ok:true}` → trình duyệt chuyển sang
   `index.html?scene=pixistudio.sharedScene&from=mapeditor`.
3. Studio boot: `MapLink.checkIncoming()` đọc shared key, validate
   `format === 'pixistudio-shared-scene-1'`, import terrain + objects vào
   `Viewport.modelRoot` (`MapLink.importShared`), rồi **xoá key** để không
   import lại lần sau.

### Fallback (shared key ghi thất bại — localStorage đầy / bị chặn)
1. `SharedScene.write()` trả `{ok:false, reason:'quota'|'security'|'unknown',
   message}` (không throw).
2. Map Editor **tự động tải** file `<tên-map>.shared-scene.json`
   (vd. `Truong_Bach.shared-scene.json`) xuống thư mục Downloads.
3. Hiện **panel hướng dẫn 3 bước**:
   1. File vừa được tải xuống (kiểm tra thư mục Downloads).
   2. Bấm nút **“Đã tải xong — Mở Studio”** để mở Studio.
   3. Trong Studio, bấm nút **“Import Shared JSON”** trên thanh topbar rồi
      chọn file vừa tải.
4. Bấm **“Đã tải xong — Mở Studio”** → mở `index.html` (không cần shared
   key). Bấm **“Đóng”** để ở lại Map Editor.
5. Trong Studio, bấm **Import Shared JSON** (`#btn-import-shared`, cạnh nút
   Map Editor) → chọn file `.shared-scene.json` → `MapLink.importSharedFromFile`
   đọc file → validate `format` + `map` → tái dùng đúng
   `MapLink.importShared(doc)` (không viết lại logic import).

### Export file thủ công (không cần mở Studio ngay)
- Nút **⬇ Export Shared JSON** (`#me-export-shared-btn`, tự gắn bằng JS trong
  `MapExport.bindSharedButtons()` ngay cạnh nút `Mở trong Studio` — không sửa
  `MapEditor.html`/`MapEditor.js`) → tải `<tên-map>.shared-scene.json`.
  Sau đó mở Studio bất cứ lúc nào và dùng nút `Import Shared JSON`.

## Flow chi tiết — Studio → Map Editor (chiều ngược lại)

1. Trong Studio, bấm **Map Editor** (`#btn-map-editor` →
   `MapLink.openMapEditor()`).
2. Ghi được key → mở `MapEditor.html?scene=pixistudio.sharedScene&from=studio`;
   Map Editor boot đọc key qua `MapExport.checkIncomingShared()`.
3. Ghi key thất bại → tự tải `studio-map.shared-scene.json` + notify hướng
   dẫn: mở Map Editor rồi bấm nút **Import** và chọn file này.
   (Nút Import của Map Editor đã xử lý `.shared-scene.json` — xem § “Nút
   Import sẵn có của Map Editor” bên dưới.)

## Giảm kích thước shared doc (chống chạm quota)

Trước khi ghi key **và** trước khi tải file, doc được deep-clone rồi làm tròn
`map.terrain.heights` về **3 chữ số thập phân**:
- `MapExport.compactSharedDoc(doc)` — dùng trong `exportSharedFile()` và
  `openInStudio()`.
- `MapLink._compactDoc(doc)` — dùng trong `MapLink.openMapEditor()`.

3 chữ số thập phân (≈1 mm) là đủ chính xác cho terrain; JSON gọn hơn ~30%
nên ít chạm quota localStorage (~5 MB) hơn. Không sửa `SceneData.js` —
chỉ xử lý trên bản clone tại điểm ghi/tải.

## Lỗi thường gặp

| Lỗi / triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Panel “Không ghi được shared key — localStorage đã đầy” | `QuotaExceededError`: localStorage đầy (project/autosave cũ chiếm chỗ, hoặc map quá lớn) | Làm theo 3 bước trong panel (file fallback). Dọn bớt project cũ trong Map Editor (Open → Delete) hoặc xoá autosave để lần sau dùng được đường chính. |
| “…trình duyệt chặn ghi localStorage (chế độ riêng tư / chặn cookie bên thứ ba)” | `SecurityError`: private/incognito mode, hoặc trình duyệt chặn storage | Dùng file fallback theo panel. Hoặc mở tab thường (không private) và cho phép cookie/storage cho site. |
| Studio báo “File không phải Shared Scene (format phải là pixistudio-shared-scene-1)” | Chọn nhầm file (vd. `.mapeditor.json` của Map Editor, hoặc file project Studio) | Chọn đúng file `.shared-scene.json`. File `.mapeditor.json` chỉ import được trong Map Editor, không import được trong Studio. |
| Studio báo “File JSON không hợp lệ” | File bị cắt khi tải / sửa tay hỏng JSON | Tải lại file từ Map Editor (nút Export Shared JSON). |
| Studio báo “File thiếu trường "map"” | File đúng format nhưng không có nội dung map | Export lại từ Map Editor. |
| Bấm “Mở trong Studio” nhưng Studio không nhận map | Shared key đã bị xoá/consumed ở lần mở trước, hoặc mở Studio bằng URL không có `?scene=` | Mở lại từ Map Editor, hoặc dùng file fallback (Export Shared JSON → Import Shared JSON). |
| Map Editor báo “Import lỗi” với file `.shared-scene.json` | File sai format / scene lỗi (xem `SceneData.validate`) | Kiểm tra lại file export từ Studio (phải là `.shared-scene.json`, không phải file project `.json` khác). |

## Boot Studio khi không có shared key

Không đổi hành vi cũ: `MapLink.checkIncoming()` chỉ chạy khi URL có
`?scene=` hoặc `?from=mapeditor`; không có key / key sai format / key là
echo của chính Studio (`source === 'studio'`) → trả `false` và Studio boot
bình thường. Nút `Import Shared JSON` luôn sẵn sàng, độc lập với shared key.

## Nút Import sẵn có của Map Editor (`#me-import-btn`)

**Đã xử lý `.shared-scene.json` sẵn rồi — không cần sửa.** Đọc trong
`js/mapeditor/core/MapEditor.js` (`_bindToolbar`, khoảng dòng 776–786):
file picker `#me-file-input` → nếu tên file chứa `.shared-scene.json` thì
gọi `MapExport.importSharedFile(file)`, ngược lại gọi `MapExport.importFile(file)`
(cho `.mapeditor.json`). Vì vậy flow fallback chiều Studio → Map Editor
(chỉ cần tải file rồi bấm Import trong Map Editor) hoạt động mà không cần
thay đổi gì thêm ở Map Editor.

## File liên quan

- `js/mapeditor/link/SharedScene.js` — `write()` trả
  `{ok:true} | {ok:false, reason, message}` (`reason`: `quota` / `security` /
  `unknown`); `saveProject`/`saveAutosave` giữ nguyên boolean.
- `js/mapeditor/export/MapExport.js` — `openInStudio()` fallback + panel 3 bước,
  `exportSharedFile()` + `sharedFileName()`, `compactSharedDoc()`,
  `bindSharedButtons()` (tự gắn nút Export Shared JSON cạnh `#me-studio-btn`).
- `js/core/map-link.js` — `openMapEditor()` fallback tải file,
  `importSharedFromFile()`, `_bindImportSharedButton()`, `_compactDoc()`;
  `init()` bind thêm nút Import (gọi từ `App.boot`).
- `index.html` — nút `#btn-import-shared` + `<input type=file
  id="shared-scene-file-input" accept=".json">` cạnh `#btn-map-editor`
  trong `.topbar-actions`.

## Kiểm tra

Script: `~/workspace/.test-mapeditor/test-shared-fallback-quick.js`
(chạy `node test-shared-fallback-quick.js`, mock localStorage + DOM tối thiểu,
không cần jsdom/trình duyệt). Kết quả: **25/25 pass**, gồm:

- `write()` trả đúng `{ok, reason}` cho `QuotaExceededError` → `quota`,
  `SecurityError` → `security`, ghi được → `{ok:true}`; không throw.
- Đường chính: ghi key được → chuyển `index.html?scene=pixistudio.sharedScene&from=mapeditor`, không tải file.
- Fallback quota: tự tải `Truong_Bach.shared-scene.json` đúng nội dung
  (`format: pixistudio-shared-scene-1`); heights `[0.123456789, 1.5, 2.0000001,
  -3.14159265, 0.0004]` → `[0.123, 1.5, 2, -3.142, 0]`; panel 3 bước có đủ
  tên file + nút `Đã tải xong — Mở Studio`; chưa bấm nút thì không chuyển trang;
  bấm nút → `index.html` (không cần key).
- `exportSharedFile()` cũng làm tròn heights 3 số, tên file đúng.
- Studio import từ file: file hợp lệ → `importShared` thành công, notify
  success + `bus.emit('scene:changed')`; file sai format / JSON hỏng →
  `false` + notify lỗi tiếng Việt, không crash.
- `openMapEditor()` khi quota lỗi: tự tải `studio-map.shared-scene.json` +
  notify hướng dẫn Import trong Map Editor.

Chưa kiểm tra trên trình duyệt thật / điện thoại: cần user mở Map Editor trên
điện thoại, bấm `Mở trong Studio` (đường chính) và thử fallback bằng cách
chặn storage (private mode) để thấy panel + nút Import Shared JSON.

## Giới hạn

- Fallback file chỉ chạy cùng máy / cùng trình duyệt tải file (phải tự mang
  file sang máy khác nếu đổi máy — shared key cũng vậy, vì localStorage là
  local theo origin).
- File `.shared-scene.json` không chứa model GLB/FBX gốc — object dạng
  `model` sang Studio thành placeholder (hành vi sẵn có của `importShared`).
- Panel fallback chỉ xuất hiện khi bấm `Mở trong Studio` mà ghi key lỗi;
  nếu trình duyệt chặn luôn cả tải file (download bị chặn) thì chỉ còn cách
  dùng nút `Export Shared JSON` thử lại hoặc copy project qua Export thường.
