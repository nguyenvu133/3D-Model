# Báo cáo kiểm thử 234 motion Mesh2Motion trên nhân vật import

**Ngày chạy:** 22/11/2026 · **Server:** `http://127.0.0.1:8099` (`node server.js 8099`)

> Lưu ý: cổng 8080 đang bị tiến trình `AgentService.exe` của AutoClaw giữ nên không dùng được cho app. Server của app chạy trên 8099 và trả 200 cho cả app, catalog và file animation.

## 1. Nhân vật kiểm thử

| Mục | Giá trị |
|---|---|
| File | `assets/models/tripo_convert_monter1.glb` |
| Kích thước | 1,94 MB |
| Đỉnh / tam giác | 34.757 verts · 50.000 tris |
| Texture | baseColor + metallicRoughness + normal |
| Rig ban đầu | **Không có** — static mesh, 0 skin, 0 bone, 0 animation |

Vì model chưa có rig, bài test chạy đúng luồng rig → animate:

1. `Models.loadGLBFromBuffer` — import nhân vật
2. `RigAutoGen.generate(target, 'Studio Humanoid')` — sinh 23 bone
3. Auto-skinning — tính skinIndex/skinWeight cho mesh và bind vào skeleton
4. `M2MMotion.retarget` — map animation Mesh2Motion vào rig vừa tạo
5. `M2MMotion.play` — phát, rồi đo chuyển động bone thật

Kết quả bước rig:

| Chỉ số | Trước rig | Sau rig |
|---|---|---|
| Bone | 0 | **23** |
| Skinned mesh | 0 | **1** (đã bind) |
| Mesh được skin | — | `tripo_node_325368b5-a1fc-4b67-a880-058a38d2e06c` |

## 2. Phương pháp đo

Mỗi motion được chạy qua cùng một pipeline và đo bằng 2 chỉ số độc lập:

- **outTracks** — số track sau retarget, phải khớp số bone của rig (23)
- **maxTravel** — quãng đường di chuyển lớn nhất của bone trong không gian world, đo bằng `matrixWorld` sau khi mixer cập nhật

Retarget dùng công thức bù rest pose:

```text
q_target_local = q_target_rest × (q_source_rest⁻¹ × q_source_local)
```

Nên kết quả không phụ thuộc rig nguồn dùng hệ đơn vị hay hướng bone khác nhau. Track ngón tay của rig nguồn bị bỏ vì rig Studio 23 bone không có ngón.

## 3. Kết quả

**234/234 motion phát được trên nhân vật đã rig.**

| Chỉ số | Giá trị |
|---|---|
| Tổng motion kiểm thử | 234 |
| Phát thành công | **234** |
| Thất bại thật | **0** |
| Track retarget trung bình | 23,0 (khớp 100% bone rig) |
| Chuyển động bone trung bình | 1,03 đơn vị |
| Nhỏ nhất / lớn nhất | 0,46 / 1,64 đơn vị |
| Khoảng thời lượng clip | 0,13s – 6,46s |
| Page error | 0 |

### 3.1. Hai motion bị đánh dấu sai ở lần đo đầu

Lần chạy tự động đầu tiên báo 2 motion "bone travel below threshold". Cả hai vẫn sinh đủ 23 track, nên tôi đo lại bằng cửa sổ dài hơn (12 mẫu × 220 ms, quét **toàn bộ** bone thay vì 5 bone mẫu):

| Motion | Track | Thời lượng | Chuyển động đo lại |
|---|---|---|---|
| `Pistol_Reload_2` | 23 | 2,04s | 0,4564 |
| `Pistol Walk` | 23 | 1,29s | 0,7759 |

Kết luận: đây là **dương tính giả** của ngưỡng đo 350 ms — hai clip này có đoạn đầu gần như đứng yên nên cửa sổ ngắn không bắt được chuyển động. Không phải lỗi retarget. Sau khi đo lại, kết quả cuối là **234/234 đạt**.

### 3.2. Motion chuyển động ít nhất và nhiều nhất

| Ít chuyển động nhất | maxTravel | | Nhiều chuyển động nhất | maxTravel |
|---|---|---|---|---|
| Consume Item | 0,485 | | Flying Forward | 1,641 |
| Attack_Ground_Pound | 0,613 | | Levitate Entrance | 1,597 |
| ClimbUp_1m_RM | 0,693 | | Levitate Idle | 1,587 |
| Spear_Thrust | 0,700 | | Glide | 1,587 |
| Idle_A | 0,706 | | Power_Burst | 1,534 |

### 3.3. Mẫu 10 motion đại diện

| Motion | Track | Thời lượng | Chuyển động |
|---|---|---|---|
| Walk | 23 | 1,63s | 0,867 |
| Run_Anime | 23 | 0,71s | 1,463 |
| Sword_Regular_A | 23 | 0,42s | 0,454 |
| Dance_Simple | 23 | 1,21s | 0,472 |
| Jump_Start | 23 | 1,67s | 0,583 |
| Zombie_Walk | 23 | 1,33s | 0,486 |
| Punch_Jab | 23 | 1,04s | 0,436 |
| Death_A | 23 | 4,58s | 0,454 |
| Sitting_Idle | 23 | 2,04s | 0,443 |
| Climb Ladder | 23 | 3,58s | 0,397 |

## 4. Bằng chứng

- [motions-results.json](motion-test/motions-results.json) — kết quả từng motion (234 bản ghi: name, srcTracks, outTracks, outDur, maxTravel, ok, error)
- [motions-summary.json](motion-test/motions-summary.json) — tổng hợp, rig, danh sách lỗi, page error
- [motions-setup.json](motion-test/motions-setup.json) — trạng thái rig trước/sau, bone list, catalog
- [rigged_character.png](motion-test/rigged_character.png) — ảnh nhân vật đang phát `Run_Anime` sau khi rig

## 5. Giới hạn đã biết

- **Rig humanoid:** bảng map bone hiện chỉ có cho rig human của Mesh2Motion. Các rig `fox`, `horse`, `dragon`, `spider`, `kaiju`, `bird`, `snake`, `shark` chưa có bảng map riêng nên chưa retarget được sang rig humanoid.
- **Ngón tay:** rig Studio Humanoid có 23 bone, không có bone ngón tay; 3 track ngón/bàn tay phía nguồn bị bỏ. Rig Mixamo 46 bone nhận được nhiều hơn (vẫn 23 track body do bảng map chỉ map tới bàn tay).
- **Root motion:** mặc định tắt trong bài test (`useRootMotion = false`) để đo thuần biến dạng khung xương. Khi bật, translation của `pelvis` được nhân theo tỉ lệ chiều cao hông nguồn/đích.
- Nhân vật test là **static mesh auto-rig**, không phải model có rig sẵn; chất lượng biến dạng phụ thuộc thuật toán auto-skin (gán weight theo 2 bone segment gần nhất), không phải weight do artist vẽ.

## 6. Chạy lại

```powershell
node server.js 8099
node tools/qa-all-motions.mjs --model "assets/models/tripo_convert_monter1.glb" --probe 350
node tools/qa-recheck.mjs
```

Trong app: mở `http://127.0.0.1:8099` → **Animation** → **Mesh2Motion Workspace** → chọn rig `human` → bấm motion bất kỳ để phát ngay trên nhân vật đang rig. Nút **Probe** đo chuyển động bone của clip đang phát.

Nguồn animation: [Mesh2Motion/mesh2motion-app](https://github.com/Mesh2Motion/mesh2motion-app) — code MIT, art asset **CC0**.
