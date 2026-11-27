# js/vendor/ — Thư viện đã vendor cho studio + MapEditor (offline / `file://`)

`index.html` tải 14 file này làm **nguồn chính** (local, chạy được qua
`file://` khi không có mạng). Khi file local lỗi mới fallback sang CDN
jsdelivr (`onerror="document.write(...)"` trong `index.html`). Toàn bộ là
**text UTF-8** (không binary) nên đẩy được lên GitHub bằng snapshot push.

## Danh sách file (cập nhật 2026-11-27)

| File | Phiên bản | Nguồn (jsdelivr) | Byte |
|---|---|---|---|
| `three.min.js` | three r128 | `three@0.128.0/build/three.min.js` | 603.445 |
| `GLTFLoader.js` | three r128 | `three@0.128.0/examples/js/loaders/GLTFLoader.js` | 96.550 |
| `OBJLoader.js` | three r128 | `three@0.128.0/examples/js/loaders/OBJLoader.js` | 21.560 |
| `MTLLoader.js` | three r128 | `three@0.128.0/examples/js/loaders/MTLLoader.js` | 10.576 |
| `STLLoader.js` | three r128 | `three@0.128.0/examples/js/loaders/STLLoader.js` | 9.847 |
| `FBXLoader.js` | three r128 | `three@0.128.0/examples/js/loaders/FBXLoader.js` | 100.686 |
| `TransformControls.js` | three r128 | `three@0.128.0/examples/js/controls/TransformControls.js` | 45.539 |
| `GLTFExporter.js` | three r128 | `three@0.128.0/examples/js/exporters/GLTFExporter.js` | 57.871 |
| `OBJExporter.js` | three r128 | `three@0.128.0/examples/js/exporters/OBJExporter.js` | 6.013 |
| `STLExporter.js` | three r128 | `three@0.128.0/examples/js/exporters/STLExporter.js` | 4.162 |
| `BufferGeometryUtils.js` | three r128 | `three@0.128.0/examples/js/utils/BufferGeometryUtils.js` | 23.040 |
| `pixi-7.4.3.min.js` | pixi.js 7.4.3 | `pixi.js@7.4.3/dist/pixi.min.js` | 456.150 |
| `pixi.min.js` | pixi.js 8.23.0 | `pixi.js@8.23.0/dist/pixi.min.js` | 912.519 |
| `meshopt_decoder.js` | meshoptimizer 0.18.1 | `meshoptimizer@0.18.1/meshopt_decoder.js` | 23.379 |
| `meshopt_simplifier.js` | meshoptimizer 0.18.1 | `meshoptimizer@0.18.1/meshopt_simplifier.js` | 16.066 |
| `fflate.js` | fflate 0.6.10 | `fflate@0.6.10/umd/index.js` | 29.679 |
| **Tổng 16 file** | | | **~2.417.082 (~2,42 MB)** |

## Kiểm chứng (2026-11-27)

- `file` → JavaScript/ASCII text, UTF-8, 0 byte NUL, không có trang lỗi HTML.
- `node --check` OK cả 16 file (các file `examples/js` của three r128 là
  script thường, không phải module — `node --check` vẫn kiểm tra được cú pháp).
- 6 file cũ (`three.min.js`, `GLTFLoader.js`, `FBXLoader.js`,
  `TransformControls.js`, `fflate.js`, `meshopt_simplifier.js`) có **sha256
  giống hệt** bản tải mới từ jsdelivr đúng version — tức là đã đúng bản từ
  trước, không cần tải lại. `fflate.js` local chính là bản fflate@0.6.10 UMD
  nên **không** tạo thêm `fflate.min.js`.

## ⚠️ Hai file pixi — đừng nhầm

- `pixi-7.4.3.min.js` — studio (`index.html`) dùng. Studio viết theo API
  pixi v7 (`new PIXI.Application({...})`, `PIXI.Text`, `PIXI.BLEND_MODES`…).
- `pixi.min.js` — **pixi v8.23.0, chỉ MapEditor dùng** (`MapEditor.html` trỏ
  thẳng tên này). Đừng ghi đè, đừng đổi tên, đừng trỏ studio sang file này
  (v8 đổi constructor `Application` thành async `init()` — studio sẽ không boot).

## Tải lại khi cần

Tải đúng URL jsdelivr ở bảng trên (đúng version — three r128 / pixi 7.4.3 /
meshoptimizer 0.18.1 / fflate 0.6.10), ghi đè file cũ, rồi chạy
`node --check js/vendor/*.js` và so `sha256sum` với bản CDN. **Không đổi tên
file** — `index.html` và `MapEditor.html` đang trỏ thẳng vào các tên này.
Nếu jsdelivr fail thì dùng unpkg cùng version
(`https://unpkg.com/<package>@<version>/<path>`).
