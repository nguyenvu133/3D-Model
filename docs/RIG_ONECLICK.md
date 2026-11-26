# Rig 1 Lượt — kiểu Meshy Animate

> Tính năng rig "tạo 1 lượt" trong tab **Rig**: một cú nhấp chạy hết quy trình
> detect → căn chỉnh → marker → dựng skeleton → skinning → QA → Export FBX
> (preset Mixamo 2013). Chạy **local, không cần key Meshy**.

## So sánh với dialog Rig Model của Meshy Animate

| Meshy Animate (workspace → Animate) | Studio — Rig 1 Lượt |
|---|---|
| Hộp thoại **Rig Model**: chọn loại model (Humanoid / creature…) | Panel chọn **Loại nhân vật**: Tự động / Humanoid / Bốn chân / Chim / Custom — map vào `detectCharacterType` + preset skeleton |
| Tự căn chỉnh: đứng thẳng, chân chạm đất, mặt hướng +Z | `align`: xoay mặt +Z, scale về chiều cao chuẩn (mặc định 1.7 m), `groundSnap` chân về y = 0 |
| Đặt marker khớp: đầu, cổ, vai, khuỷu, cổ tay, hông, gối, cổ chân | 7 marker **% chiều cao**: cằm / vai / khuỷu / cổ tay / háng / gối / cổ chân — chỉnh số, nút **Reset marker**, checkbox **Đối xứng** (mirror trái↔phải) |
| Kiểm tra đối xứng | Checkbox đối xứng; QA `qaReport` có mục Symmetry |
| Bấm **Rig** → Smart Rig xử lý → model có skeleton | Nút **⚡ Rig 1 Lượt** → pipeline 5 bước, hiện tiến trình từng bước + kết quả |
| — | Nút **🔁 Rig lại**: chỉnh marker rồi rig lại, không làm lại từ đầu |
| Export riêng (Meshy cloud, tốn credit) | Nút **📥 Export FBX (Mixamo 2013)** ngay trong luồng, sau khi rig xong |

**Giới hạn đã biết** (ghi rõ, như Meshy cũng có):

- Trang workspace của Meshy cần đăng nhập nên **không xem trực tiếp được** —
  đối chiếu dựa trên tài liệu Meshy công khai + API params trong
  `js/ai/meshy-adapter.js` (`rigModel`: `animation_type` biped/quadruped,
  `skeleton_template` mixamo/ue5_mannequin/unity_humanoid/…, `include_fingers`,
  `height_meters` mặc định 1.7, rigging 5 credits).
- Marker của studio chỉnh bằng **số %**, chưa kéo-thả trực tiếp trên viewport
  như Meshy.
- **Chim / bốn chân**: studio chưa có khung xương chim; rig humanoid trên chim
  chỉ là best-effort (báo rõ bằng tiếng Việt). Bốn chân cần module
  `CreatureRigs` (`js/rigging/creature-rigs.js`); nếu chưa nạp thì báo lỗi rõ,
  không crash. Mixamo auto-rig cũng không nhận chim.

## Luồng hoạt động (từng bước)

Nút bấm nằm trong tab **Rig**, section `#rig-oneclick-section` ở đầu trang
(`js/rigging/rig-oneclick.js` → `PixiStudio.RigOneClick`, hook trong
`RigAutoGen.renderPanel()`).

```
1. Detect — RigAutoGen.detectCharacterType (hoặc loại đã chọn tay)
           → humanoid / quadruped / bird / custom
2. Align   — RigAutoGen.align: rotateY mặt +Z, scale về heightM (mặc định
             1.7 m), groundSnap chân về y = 0
3. Markers — 7 marker % (cằm 0.78, vai 0.72, khuỷu 0.52, cổ tay 0.33,
             háng 0.52, gối 0.28, cổ chân 0.06); validate 0–100%
4. Rig     — Humanoid/Bird/Custom: dựng khung 65 xương mixamorig
             (MixamoSkeleton.build trên bản sao, cao 1.8 m) để xuất, rồi
             RigAutoGen.generate (preset đã chọn, 23 xương viewport + 20
             xương ngón tay nếu bật Fingers) + bindSkin
             Quadruped: CreatureRigs.build (async), rig xong là xong
5. QA      — RigAutoGen.qaReport (Bone count / Symmetry / Rig height /
             Skin coverage) + MixamoValidator.check(mode 'rig')
```

Kết quả hiện: số xương viewport, số xương khung xuất Mixamo, số mesh đã skin,
chiều cao, tris, cảnh báo/lỗi. Mọi lỗi báo bằng tiếng Việt qua `notify`, không
throw ra ngoài (`runOneClick` luôn resolve `{ ok, ... }`).

### Rig lại (reRig)

Chỉnh marker → bấm **🔁 Rig lại**: chạy lại toàn bộ pipeline với marker mới.
Rig cũ được tháo trước (`clearTarget` khôi phục mesh rigid) để khung 65 xương
thu thập được mesh — `MixamoSkeleton.build` bỏ qua SkinnedMesh nên rig lại
trên model đã skin mà không tháo trước sẽ không ra khung xuất.

## Nút Export FBX

- Nút **📥 Export Mixamo (mesh-only, Mixamo tự rig)**, chỉ bật sau khi rig xong
  (`exportReady`), tên file: `<tên-model>_mixamo.fbx` (Lần 7: bỏ chữ "rigged"
  vì file là mesh-only, không có xương).
- Dùng đúng writer đã sửa `js/exporter/fbx-binary.js` — **không viết writer
  mới, không sửa writer** (xem `docs/MIXAMO_EXPORT_FIX.md`: footer chuẩn SDK,
  FileId đúng, Video Path cho texture).
- Preset (như nút Save Mixamo Rig trong `save-manager.js`, từ Lần 4 file xuất
  ra LUÔN mesh-only): `FBXBinary.write(prepared.group, { version: 7300,
  noSkeleton: true, prepareMixamo: true, upAxis: 'Y', autoScale: true,
  embedTextures: true })` sau `MixamoSafeExport.prepare` + pre-flight
  mesh-only — kèm `waitForTextures(out, 8000)`.
- Nguồn xuất: khung 65 xương đã cache từ lúc rig (`lastBuild`); nếu chưa có
  thì dựng mới; bốn chân xuất thẳng model đã rig (không dựng khung humanoid);
  nếu dựng khung thất bại thì xuất model đã rig với rig viewport (fallback,
  vẫn có xương mixamorig).
- Pre-flight 2 lần bằng `MixamoValidator.check(mode 'rig')`: trên model gốc
  (chặn > 50.000 tris, không có mesh) và trên nhóm xuất. Không đạt → không
  xuất, báo rõ lý do.

## File đã sửa / tạo

| File | Thay đổi |
|---|---|
| `js/rigging/rig-oneclick.js` | **MỚI** — `PixiStudio.RigOneClick`: `runOneClick`, `reRig`, `buildExportBytes`, `exportRiggedFBX`, `renderPanel` |
| `js/rigging/rig-auto-gen.js` | Hook `RigOneClick.renderPanel()` cuối `renderPanel()`; **fix `bindSkin` giữ nguyên transform** của mesh gốc khi thay bằng SkinnedMesh (trước đây mesh nhiều mảnh bị sập về origin) |
| `js/exporter/mixamo-validator.js` | **Fix `collect()`**: chỉ bỏ visual xương; mesh đã skin (`skipSkin`) vẫn là mesh thật phải đếm (trước đây validator báo "Không có mesh nào" trên model vừa rig xong) |
| `index.html` | Thêm `<script src="js/rigging/rig-oneclick.js">` sau `creature-rigs.js` |
| `docs/RIG_ONECLICK.md` | Tài liệu này |
| `~/workspace/.test-fbx/test-rig-oneclick.js` | Harness (không nằm trong repo) |

## Kiểm thử

Harness `~/workspace/.test-fbx/test-rig-oneclick.js` (node, three r128 +
jsdom, không cần trình duyệt): **39/39 pass × 2 lần**.

| § | Nội dung |
|---|---|
| 1 | Humanoid auto: detect humanoid, 5 bước done, 23 xương viewport, khung xuất 65 xương mixamorig, ≥ 1 mesh đã skin, cao 1.7 m, chân y = 0, QA ok, validator ok, skin weights tổng ≈ 1.0, skinIndex < 65 |
| 2 | Marker chin 0.78 → 0.80 dời xương Head, reRig vẫn 23 xương |
| 3 | Export: tên file, version 7300, 65 xương + có skin, FBXLoader parse được, 65 tên xương duy nhất, có SkinnedMesh, Hips y ≈ 0.94, chân y ≈ 0, **fbx2gltf (FBX SDK thật) đọc được 6 mesh + 6 skin** |
| 4 | Model có texture: export nhúng ≥ 1 texture, fbx2gltf trích được ảnh + `baseColorTexture` |
| 5 | Model chim: hoàn tất không crash, có cảnh báo tiếng Việt, export ra FBX, fbx2gltf đọc được mesh |
| 6 | Bốn chân khi chưa nạp CreatureRigs: lỗi rõ, không crash |
| 7 | Model 52.272 tris bị pre-flight chặn, notify báo rõ giới hạn 50.000 |
| 8 | Không có model: lỗi rõ "Chưa có model nào", không crash |

Hồi quy sau khi sửa `rig-auto-gen.js` / `mixamo-validator.js` (đều pass):
`test-fbx-mixamo.js` 73/73 · `test-xbot-mixamo.js` 39/39 ·
`test-thandieu-mixamo.js` 30/30 · `test-obj-texture.js` 29/29.

**Lưu ý về FBXLoader r128** (ghi trong harness §3.6): khi 1 skeleton gắn
nhiều mesh, loader nhân đôi 1 số xương (78 object / 65 tên duy nhất) kèm cảnh
báo "skeleton attached to more than one geometry is not supported". File FBX
vẫn đúng — FBX SDK đọc 6 mesh + 6 skin. X Bot (1 mesh) parse ra đúng 65.
