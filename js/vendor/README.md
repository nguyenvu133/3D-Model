# js/vendor/ — Thư viện đã vendor cho MapEditor (offline)

MapEditor.html tải 6 file này làm **nguồn chính** (local, chạy được qua
`file://` khi không có mạng). Khi file local lỗi mới fallback sang CDN
(jsdelivr → unpkg). Toàn bộ là **text UTF-8** (không binary) nên đẩy
được lên GitHub bằng snapshot push.

Tải về từ jsdelivr ngày 2026-11-24, đúng phiên bản MapEditor dùng:

| File | Nguồn | Byte |
|---|---|---|
| `three.min.js` | three@0.128.0/build/three.min.js | 603.445 |
| `pixi.min.js` | pixi.js@8.23.0/dist/pixi.min.js | 912.519 |
| `GLTFLoader.js` | three@0.128.0/examples/js/loaders/GLTFLoader.js | 96.550 |
| `TransformControls.js` | three@0.128.0/examples/js/controls/TransformControls.js | 45.539 |
| `fflate.js` | fflate@0.6.10/umd/index.js | 29.679 |
| `FBXLoader.js` | three@0.128.0/examples/js/loaders/FBXLoader.js | 100.686 |
| **Tổng** | | **1.788.418 (~1,79 MB)** |

Kiểm chứng: `file` → JavaScript/ASCII text, UTF-8, 0 byte NUL;
`node --check` OK cả 6 file; header chứa đúng tên thư viện
(`Three.js Authors`, `PixiJS`, `GLTFLoader`, `TransformControls`,
`fflate`, `FBXLoader`).

## Cập nhật phiên bản

Tải lại đúng URL jsdelivr ở bảng trên, ghi đè file cũ, rồi chạy
`node ~/workspace/.test-mapeditor/test-offline-mapeditor.js` để
kiểm tra lại kích thước + header. **Không đổi tên file** — MapEditor.html
đang trỏ thẳng vào 6 tên này.
