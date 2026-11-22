# Báo cáo: tách 2 rig riêng + sắp xếp Rig/Animation + Rig Bridge Tripo ↔ Meshy

**Ngày:** 22/11/2026 · **Server:** `http://127.0.0.1:8099` (`node server.js 8099`)
**Nhân vật kiểm thử:** [kiem hiep.glb](<assets/models/kiem hiep.glb>) (32.661 verts, 1 mesh, 3 texture PBR)

---

## 1. “Button Auto Rig Gen có 2 xương bone” — đã tách thành 2 rig riêng

### Nguyên nhân

`RigAutoGen.generate()` có khối **reuse**:

```js
if (RigAutoGen.current && RigAutoGen.current.target === target) {
  /* chỉ regenerate clips — KHÔNG tạo rig mới */
  return RigAutoGen.current;
}
```

Nghĩa là: bấm nút Studio rồi bấm nút Mixamo, rig Mixamo **không được tạo** mà chỉ tái sinh clip trên rig Studio; khi dùng CreatureRigs (họ động vật) lại **cộng dồn** wrapper skeleton mới lên rig cũ → scene có **nhiều bộ xương cùng lúc** (test cũ: sau Creature có 89 bone, 3 rig root) → “có 2 xương bone” như bạn thấy, và animation dùng chung lung tung.

### Đã sửa

1. **Tách thành 2 nút riêng, mỗi nút một preset riêng** trong [rig-auto-gen.js](<js/rigging/rig-auto-gen.js>):
   - `Studio Humanoid · 23 bone`
   - `Mixamo/Meshy · 23 bone`
2. **Reuse chỉ khi cùng preset**; đổi preset thì tháo rig cũ trước:
   ```js
   if (RigAutoGen.current && RigAutoGen.current.target === target
       && RigAutoGen.current.preset === presetName) { reuse }
   ...
   if (RigAutoGen.current) RigAutoGen.clearTarget(RigAutoGen.current.target);
   ```
3. **`clearTarget(target)`**: dừng mixer, gỡ skeleton helper, gỡ rig root, và **khôi phục mesh rigid ban đầu** (lưu `__sourceMesh` trong userData lúc bind) — không để SkinnedMesh cũ nằm lại.
4. **CreatureRigs.build** cũng gọi `clearTarget` trước khi dựng rig họ mới, và lưu `__sourceMesh`.
5. Nút “🧠 Refine active rig — Backend Analyze (Tripo)” giờ **chỉ tinh chỉnh rig đang active**, không tạo rig thứ hai.

### Kiểm chứng (bấm tuần tự trên cùng model)

| Bước | Bone | Rig root | Skinned | Active rig |
|---|---|---|---|---|
| Bắt đầu | 0 | 0 | 0 | — |
| Bấm Studio Humanoid | **23** | 1 | 1 | `Studio Humanoid` |
| Bấm Mixamo/Meshy | **23** | 1 | 1 | `Mixamo Compatible` |
| Bấm Creature human | **66** | 1 | 1 | `CreatureRig (human)` |

Không còn bộ xương chồng; đổi giữa 2 rig chỉ còn đúng số bone của rig đó. 0 page error.

Nhãn **Active rig** trong panel giờ cập nhật ngay sau mỗi nút bấm (đã sửa `renderPanel` luôn dựng lại thay vì guard “đã tồn tại”).

---

## 2. “Animation library có mô hình to quá màn hình” — auto-fit camera

- Sau mỗi lần `generate()` và `CreatureRigs.build()`, gọi `Viewport.focusSelected()` để camera tự khép về bbox model (bao gồm skeleton mới).
- Kiểm chứng khung hình (NDC, |v| ≤ 1 là nằm trong màn hình): sau rig, model cao 2 đơn vị được fit với bán kính ~3,92; các đỉnh bbox nằm trong NDC, không tràn khung hình.

Nếu bạn vẫn thấy model to hơn mong muốn, trong panel Camera & Scene có thể: **Focus (F)**, chỉnh **FOV**, hoặc dùng nút nudge/ô nhập X/Y/Z để đặt lại vị trí.

---

## 3. Sắp xếp lại Rig & Animation — không lộn xộn

- Panel **Rig** giờ có trật tự:
  1. 2 nút rig riêng (Studio / Mixamo) + nhãn Active rig
  2. Refine active rig (Tripo backend)
  3. Play/pause, ẩn/hiện skeleton
  4. **Rig Bridge — Tripo ↔ Meshy** (mục 4)
  5. Pipeline info
- Mỗi module render vào đúng chỗ, không còn hai “Auto Rig Gen” dùng chung.

---

## 4. “Muốn dùng chung Tripo vào Meshy.ai và ngược lại” — Rig Bridge

Thêm khối **Rig Bridge — Tripo ↔ Meshy** trong [meshy-rigging.js](<js/rigging/meshy-rigging.js>):

- Chọn chuẩn đích: **Tripo Studio / Studio Humanoid** hoặc **Meshy / Mixamo Compatible**
- **Apply Bridge**: đổi rig theo chuẩn đích (tháo skin cũ, bind lại) → cùng một mesh có thể “dùng chung” giữa Tripo-style và Meshy-style
- **Bridge QA**: đếm bone/skinned mesh của rig đang active
- **Export Bridge GLB**: xuất GLB + animation theo chuẩn đã chọn

Kèm theo từ các lần trước:
- **FBX Binary (Mixamo-ready)**: [fbx-binary.js](<js/exporter/fbx-binary.js>) — xuất rig+skeleton+skin sang FBX 7400 để đưa ngược vào Mixamo/Meshy (đã kiểm chứng đọc lại được 23 bone + 1 SkinnedMesh).
- **Mesh2Motion 326 motion**: retarget theo tên bone (identity) hoặc map humanoid — dùng chung trên rig Tripo/Meshy.

---

## 5. File thay đổi

- [rig-auto-gen.js](<js/rigging/rig-auto-gen.js>) — tách 2 nút, clearTarget, render lại, refine không tạo rig 2
- [creature-rigs.js](<js/rigging/creature-rigs.js>) — clearTarget trước build, lưu __sourceMesh, auto-fit
- [meshy-rigging.js](<js/rigging/meshy-rigging.js>) — Rig Bridge panel, sync state qua bus, render vào page-rig chính
- [app.js](<js/core/app.js>) — gọi `MeshyRigging.init()` lúc boot

## 6. Kiểm thử

- `tools/qa-rigdup.mjs` — bấm tuần tự 3 loại rig, đếm bone/rigRoot/skinned (kết quả mục 1)
- Smoke test bấm nút Studio → Mixamo → nhãn Active rig = `Studio Humanoid` / `Mixamo Compatible`, 0 page error
- Cú pháp `node --check` tất cả module liên quan: OK
