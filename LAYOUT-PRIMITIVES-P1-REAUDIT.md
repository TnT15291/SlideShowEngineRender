# Nghiệm thu lại Pha 1 — `P1.7R`

> Phiên: Claude, 2026-07-30 22:10–22:30 +07:00.
> Đây là bản nghiệm thu lại gate `P1.7`. Bản `P1.7` ghi lúc 22:25 vẫn giữ nguyên trong nhật ký
> nhưng **đã lỗi thời**: xem §1.
>
> File này tách khỏi `LAYOUT-PRIMITIVES-PROGRESS.md` vì phiên Codex đang giữ `P2A.4`
> `IN_PROGRESS` và ghi tracker cùng lúc. Chủ sở hữu tracker nên gộp §5 vào nhật ký.

## 1. Vì sao gate `P1.7` cần chạy lại

`P1.7` phát biểu là "mắt người nhìn từng layout mới một lần, trước khi wire vào recipe".
Probe đã dùng 3 ảnh JPEG **nhiễu tổng hợp** lấy từ fixture Premium
(`projects/layout-primitives-premium-baseline/input/{002,003,029}.jpg`).

Trên ảnh nhiễu, cả 7 layout đều render "đúng". Nhiễu không thể lộ ra thiệt hại cắt cúp,
không thể lộ ra thiếu tín hiệu chiều sâu, không thể lộ ra khoảng chết. Nói cách khác gate
đã chạy ở dạng **không thể fail**, nên nó không bảo chứng được điều nó tuyên bố.

Hai điểm phụ của probe cũ:

- Toạ độ được **chép tay** vào `temp/probe-primitives.json`, không đọc từ
  `layouts/library.json`. Probe sẽ trôi khỏi library ngay khi một layout được sửa, và vẫn
  tiếp tục "pass".
- Log render của chính lần chạy đó đã in cảnh báo preflight crop-risk cho từng slide.
  Nhật ký `P1.7` không ghi lại dòng nào trong số đó.

## 2. Probe mới

`scripts/renderPrimitiveProbe.mjs` — dựng timeline probe **đọc thẳng từ library**:

```powershell
node scripts/renderPrimitiveProbe.mjs --photos temp/probe-photos --out temp/probe-real.json
Remove-Item -Recurse -Force temp/scene-cache
npm run render -- --timeline temp/probe-real.json
```

- Ảnh: 6 ảnh cưới thật (`input/Pictures/Quốc - Nhi`), gồm landscape 4:3, 3:2 pro 7008×4672
  và ba ảnh dọc 3:4.
- Gán ảnh theo **aspect gần nhất**, như solver khớp `orient`, chứ không xếp hạng slot so với
  cả pool — cách xếp hạng đó đưa ba dải ngang giống hệt nhau ba ảnh dọc nhất và tạo ra
  một lỗi giả.
- Panel không có `z: "over_photos"` được vẽ **trước** ảnh, đúng như
  `scripts/lib/layerSceneBuilder.mjs:78`.
- `transition: none` để mỗi frame trích ra không bao giờ là nửa của hai layout.
- Script nằm trong `tsconfig.scripts.json`, `typecheck:scripts` exit 0.

## 3. Bốn lỗi thiết kế probe ảnh thật phát hiện, và bản sửa

| Layout | Triệu chứng trên ảnh thật | Sửa |
|---|---|---|
| `overlap_stack_duo` | Ảnh `front` xoay −3° đè lên `back` mà **không viền, không shadow**. Hai ảnh nhập làm một khối; cạnh ảnh trước cắt ngang tay cô dâu trong ảnh sau như lỗi render. Chính `intent` của layout nói "chiều sâu, không phải lưới". | `front` nhận `frame: {border 14, #FFFFFF, shadow}`. Viền được vẽ **bên trong** slot (`buildLayerSceneCommand.ts:99`) nên footprint, coverage, Key V2 và shape key đều không đổi; `rotate` chạy sau `pad` nên viền xoay theo thẻ. |
| `stacked_horizon_trio` | 1560×270 = **5,78:1**, slot rộng nhất toàn library (kế tiếp là 4,24:1 và đó chỉ là dải phụ trong mosaic 9 ảnh). Preflight báo **87% crop risk**. Ảnh thật: hai trong ba dải cắt ngang mặt người — mất trán, mất cằm. Ba dải cùng x, cùng kích thước nên đọc ra như ảnh thử sọc. | Cắt lại 1180×300 = **3,93:1**, x so le 180 / 560 / 180, y 60 / 390 / 720. Crop risk xuống 66–83%, coverage 60,9% → 51,2%. |
| `offset_portrait_hero` | 46,6% coverage, thanh accent 18×760 lơ lửng giữa canvas, ~38% khung phải là kem trống. Đọc ra như layout chưa làm xong. Nó lại được thiết kế để thay `gallery_matte_hero` (56,3%) trên 23 recipe — tức là **thay bằng cái mỏng hơn**. | `hero` 150,90 1240×900 (**53,8%**); accent thu còn 14×900 và đẩy về x=1700, canh đúng mép trên/dưới của ảnh. Khoảng kem trở thành gutter có chủ đích với một thanh chặn ở lề phải. |
| `diagonal_staircase_trio` | 37,3% coverage — thấp nhất trong 7. Hai lỗ lớn: cả góc dưới trái, và khoảng giữa heading với ảnh `low`. | Slot 560×460 → **620×500**, bậc thang dịch ra 90/650/1210. Coverage **44,8%**. Heading dời lên `1210,75 620×180`, đúng cột của `low`. |

### Một lỗi validator bắt được trong lúc sửa

Lần siết `diagonal_staircase_trio` đầu tiên đặt heading ở `1210,140 600×180`, chạm ảnh `mid`
một vùng 60×30 px. `G6` bắt đúng và fail. Đây là bằng chứng validator Pha 0C có tác dụng thật,
không phải chỉ chạy cho có. Đã sửa bằng cách nâng heading lên `y=75`.

## 4. Gate đã chạy lại sau khi sửa

| Gate | Kết quả |
|---|---|
| `node scripts/validateLayoutPrimitive.mjs layouts/library.json` | **32/32 pass, 0 error, 20 warning** (3 G4 + 17 G5, đều là baseline cũ) |
| `node scripts/lintStoryTemplates.mjs` | **24 clean, 0 failing** |
| `layout-geometry` + `library` + `template-recipes` | **28/28 pass** |
| `npm run typecheck:scripts` | exit 0 |
| Metric V2 | `catalog 56`, `authored 48/30`, `reachable maxShare 23 / over12 7` — **không đổi** |
| Premium dry-run STUB, cùng invocation | exit 0; log chuẩn hoá **176/176 dòng giống hệt** `temp/premium-before.txt`; 38 scene; ảnh/scene `1×0, 28×1, 9×6`; 82 ảnh unique; không có card 4/5 |

Artefact: `temp/probe-real.json`, `temp/probe-real.mp4`, `temp/premium-after2.txt`.

## 5. Blocker mở cho Pha 2A

`scripts/newPrimitiveAdoptionMap.json` (viết lúc ~22:2x, trước bản sửa này) có **46 trên 69**
entry đặt `layoutOverrides` lên bốn layout vừa đổi toạ độ. Các override đó suy ra từ hình học cũ:

- **`stacked_horizon_trio`** — override đẩy `width` về 1500–1660 và `x` về 130–210.
  Áp lên slot mới thì dải thành ~5,4:1, tức **dựng lại đúng vấn đề cắt mặt vừa sửa**, đồng thời
  phá thế so le. Đây là hạng mục nặng nhất.
- **`offset_portrait_hero`** — override ép `hero` về `1020×900`, nhỏ hơn `1240×900` mới, mà
  không đụng tới panel. Panel giờ ở x=1700 nên khoảng chết còn **rộng hơn trước khi sửa**.
- **`diagonal_staircase_trio`** — các nudge (`mid` x660 y280, `low` x1270 y560, `top` x140 y70)
  tính theo slot 560×460 ở vị trí cũ. Với slot 620×500, `low` tại x=1270 chạm mép phải ở 1890.
- **`overlap_stack_duo`** — tương thích. Override chỉ dời/xoay `front`, không xoá `frame` mới.

Không sửa map trong phiên này: đó là việc đang mở của phiên khác. Phiên sở hữu `P2A` cần suy
lại 46 override đó trên hình học mới rồi chạy lại `--check-plan`.

## 6. Việc chưa làm, có chủ đích

- **`stacked_horizon_trio` vẫn là layout kén ảnh phong cảnh.** 3,93:1 nhẹ hơn 5,78:1 nhưng
  ảnh 3:2 vẫn mất 62% chiều cao. Ba dải ngang chiếm trọn 1080px thì không thể vừa rộng vừa
  an toàn cho khuôn mặt. Ngoài ra `applyFaceSafeFraming` cứu ảnh bằng cách đổi `cover` sang
  `contain` (`src/faceSafeFraming.ts:51`), nên một ảnh có `faceBox` bị cắt quá ngưỡng sẽ thành
  ảnh nhỏ trôi giữa dải trống. Pha 2 phải chỉ gắn primitive này vào beat phong cảnh/chuyển chương.
- **Tên `offset_portrait_hero` không khớp hình.** Slot là 1240×900, tức ngang. Không đổi tên vì
  id đã bị khoá trong `test/library.test.mjs`, trong plan và trong adoption map.
- **Look có thể đè chết `frame` của layout.** `layerSceneBuilder.mjs:96` giải theo thứ tự
  `def.frame` → `scene.resolvedFrame` → `slot.frame`, nên một look đặt `frame` sẽ xoá cả frame
  tròn của `circle_trio_stagger` lẫn viền thẻ mới của `overlap_stack_duo`. Plan đã nêu ở dòng
  190 cho trường hợp hình tròn; giờ nó áp cho hai layout. `G8` không bắt được việc này vì nó chỉ
  kiểm tên preset có giải được hay không.
