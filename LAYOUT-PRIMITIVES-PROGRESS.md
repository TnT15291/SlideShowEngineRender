# Theo dõi triển khai Layout Primitives

> Nguồn thiết kế: [LAYOUT-PRIMITIVES-PLAN.md](LAYOUT-PRIMITIVES-PLAN.md)
>
> File này là **nguồn trạng thái duy nhất** để bàn giao giữa các session. Mọi session triển khai
> phải đọc file này trước, nhận đúng một bước, và cập nhật lại trạng thái, bằng chứng kiểm chứng
> cùng bước tiếp theo trước khi kết thúc.

## 1. Trạng thái nhanh

| Trường | Giá trị |
|---|---|
| Trạng thái tổng | `IN_PROGRESS` |
| Pha hiện tại | `Pha 2D — nghiệm thu và tài liệu` |
| Bước đang thực hiện | Không có |
| Bước hoàn thành gần nhất | `P2C batch B5` — **rollout hoàn tất**: 70/70 adoption đã ghi, 0 group nào còn trên trần 12 |
| Bước tiếp theo | `P2D` — nghiệm thu cuối: P2D.4 `preview:tier1` trên 2 job thật, P2D.5/6 cập nhật docs, P2D.7 `docs:check`, P2D.8 `npm run check` |
| Blocker hiện tại | Không có |
| Branch lúc tạo tracker | `agent/refactor-engine-and-add-momo` |
| Commit lúc tạo tracker | `82d59a5` |
| Commit Pha 0 | `d5e8d0f` baseline snapshot → `b83d601` Pha 0 → `e43dad3` refactor |
| Commit Pha 1 | `5871122` |
| Commit Pha 2A | `4ac137c` |
| Commit Pha 2B pilot | `8161779` |
| Commit Pha 2C B1 | `161b281` |
| Commit Pha 2C B2 | `4cf6f25` |
| Commit Pha 2C B3 | `0b42562` |
| Commit Pha 2C B4 | `2294cac` |
| Commit Pha 2C B5 | `B5_SHA` |
| Cập nhật lần cuối | `2026-07-31 — P2C B5 DONE, rollout hoàn tất` |

### Quy ước trạng thái

- `TODO`: chưa bắt đầu.
- `IN_PROGRESS`: một session đang thực hiện.
- `BLOCKED`: không thể tiếp tục; phải ghi rõ nguyên nhân và điều kiện gỡ chặn.
- `DONE`: đã hoàn thành và có bằng chứng kiểm chứng.
- `SKIPPED`: chủ động không làm; phải ghi rõ quyết định/phạm vi.

## 2. Quy trình bắt buộc cho mỗi session

1. Đọc toàn bộ phần **Trạng thái nhanh**, **Bước tiếp theo** và **Nhật ký bàn giao**.
2. Chạy `git status --short` và xác nhận không ghi đè thay đổi ngoài phạm vi.
3. Chỉ nhận một bước hoặc một batch độc lập bằng cách:
   - đổi trạng thái bước thành `IN_PROGRESS`;
   - ghi session, thời điểm và phạm vi file dự kiến vào Nhật ký.
4. Thực hiện thay đổi và chạy đúng gate của bước.
5. Trước khi kết thúc session:
   - ghi file đã thay đổi;
   - ghi lệnh test và kết quả thực tế;
   - ghi số đo geometry nếu có;
   - ghi commit SHA nếu đã commit;
   - chuyển bước thành `DONE` hoặc `BLOCKED`;
   - cập nhật **Bước tiếp theo** trong bảng Trạng thái nhanh;
   - thêm một dòng vào Nhật ký bàn giao.
6. Không đánh dấu `DONE` nếu chưa chạy gate được liệt kê.
7. Không xoá lịch sử cũ. Nếu một kết quả bị thay thế, thêm bản ghi mới và ghi rõ bản cũ đã lỗi thời.
8. Không siết ratchet theo mục tiêu dự kiến; chỉ siết tới số đã đo được trên source hiện tại.

## 3. Baseline và mục tiêu

### Baseline phải xác nhận lại trên worktree sạch

| Metric V2 | Baseline trong plan | Đã xác nhận khi triển khai |
|---|---:|---|
| `catalog.distinct` | 49 | Có — P0A.5: 49; Pha 1: 56; pilot: 64; B1: 76; B2: 89; B3: 101; B4: 113; **B5: 125** |
| `authored.distinct` | 48 | Có — P0A.5: 48; pilot: 56; B1: 68; B2: 81; B3: 93; B4: 105; **B5: 117** |
| `authored.shared` | 30 | Có — P0A.5: 30; pilot–B3: 30; B4: 30 (chạm 31 rồi bị bắt và sửa — xem nhật ký B4); B5: 30 |
| `reachable.maxShare` | 23 | Có — P0A.5: 23; pilot: 22; B1: 18; B2: 15; B3: 13; **B4–B5: 12 = mục tiêu** |
| `reachable.over12Count` | 7 | Có — P0A.5: 7; pilot: 6; B1: 4; B2: 2; B3: 1; **B4–B5: 0 = mục tiêu** |
| Scene meaningful | 5 scene / 3 recipe | Có — P0A.4/P0A.5: 5 / 3 |
| `closing_names` distinct | 11 | Có — P0A.2: 11 |
| `closing_names` max group | 9 | Có — P0A.2: 9 |

### Mục tiêu cuối bắt buộc

- `catalog.distinct >= 56`.
- `reachable.maxShare <= 12`.
- `reachable.over12Count = 0`.
- 23 recipe tự do sáng tạo có ít nhất 3 scene meaningful.
- `white-weddings-full-01` giữ ít nhất 1 scene meaningful và không nhận primitive mới.
- Không mất copy trong main, `muteFallback` hoặc repeatable variant.
- Không đổi photo demand trên bất kỳ đường chạy nào.
- Mỗi primitive active có ít nhất 2 host.
- Gallery tail `s83 > s84 > s85` vẫn duy nhất giữa các recipe.
- `npm run check` xanh trên branch/worktree sạch trước merge.

## 4. Danh sách công việc

### PRE-0 — Chuẩn bị baseline sạch

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| PRE-0.1 | DONE | Chọn commit baseline dự định merge và tạo branch/worktree sạch | Branch `agent/layout-primitives`; SHA `82d59a5`; worktree `D:\Claude\Projects\SlideshowRenderEngine-layout-primitives` |
| PRE-0.2 | DONE | Đảm bảo plan và tracker có mặt trong worktree triển khai | Hai file mở được từ worktree mới; plan SHA-256 `BF226D0E...1BFA2A` |
| PRE-0.3 | DONE | Chạy `npm run check` trên baseline sạch | `CHECK_EXIT=0`; API 74/74, unit 340/340, integration 1/1, audit 0 vulnerability |
| PRE-0.4 | DONE | Chọn một Premium job cố định | `projects/layout-primitives-premium-baseline`; config và fingerprint ghi bên dưới |
| PRE-0.5 | DONE | Chạy Premium dry-run trước khi sửa library | `temp/premium-before.txt`; exit 0; SHA-256 `3549F96C...DBD883` |
| PRE-0.6 | DONE | Ghi lại baseline metric V2 sau khi metric Pha 0 chạy được | Bảng mục 3 đã điền đủ 8 dòng; đo lại độc lập 2026-07-30 19:34 trả về đúng 49/48/30/23/7 và meaningful 1/3/1 |

#### Premium job cố định cho phép so sánh trước/sau

- Project/job id: `layout-primitives-premium-baseline`.
- Project path: `projects/layout-primitives-premium-baseline`.
- Manifest: `tier=premium`, `quality=draft`, `language=vi`, `sequenceMode=editorial`, `musicMode=full_song`.
- Input: 82 JPEG synthetic, gồm 55 landscape/square và 27 portrait; không có duplicate group;
  fingerprint tập ảnh SHA-256 `EB235370...3647DEB`.
- Music: `music/River Flows In You.mp3`, 188.830 giây; SHA-256 `8610C878...F7368D`.
- Project manifest SHA-256: `7BC00919...3B238`.
- Prompt SHA-256: `A054A1AA...D63AC`.
- Cấu hình invocation cố định: `--dry-run --choice A --music-choice full`.
- Provider mode cố định: STUB; xoá `VISION_API_KEY`, `OPENAI_API_KEY` và `DEEPSEEK_API_KEY`
  trong process chạy snapshot để kết quả không phụ thuộc mạng/model.
- Không dùng `--resume`; dùng cùng project, asset fingerprint và invocation cho cả before/after.
- Snapshot trước:
  `npm run premium -- --project projects/layout-primitives-premium-baseline --dry-run --choice A --music-choice full > temp/premium-before.txt`.
- Snapshot sau dùng cùng lệnh và đổi duy nhất output thành `temp/premium-after.txt`.

### Pha 0A — Metric hình học V2

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P0A.1 | DONE | Tạo `scripts/lib/geometrySignature.mjs` | Module import được; có trong `tsc --listFilesOnly`; scripts typecheck exit 0 |
| P0A.2 | DONE | Cài `geometryKey()` với photo/text/panel/background | Assertion Key V2 xanh; `closing_names` 11 key/max 9; typecheck xanh |
| P0A.3 | DONE | Cài `slotShapeKey()` theo frame precedence thật | Assertion rect/circle/pill + precedence xanh; quét 233 scene thật; typecheck xanh |
| P0A.4 | DONE | Cài `meaningfullyDiffers()` | 1px không đổi; >=1% hoặc >=1° và silhouette có đổi; baseline 1/3/1 khớp |
| P0A.5 | DONE | Cài `geometryStats()` cho `catalog/authored/reachable/perRecipe` | Baseline 49/48/30/23/7 khớp; reachable quét main/fallback/repeat variants |

### Pha 0B — Test ratchet

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P0B.1 | DONE | Tạo `test/layout-geometry.test.mjs` | Node test runner nhận file; smoke import 1/1 pass |
| P0B.2 | DONE | Thêm baseline meaningful per recipe | Ratchet 1/3/1 xanh; file test 2/2 pass |
| P0B.3 | DONE | Thêm ratchet catalog/authored/reachable | 49/48 floor và 23/7 ceiling xanh; file test 3/3 pass |
| P0B.4 | DONE | Thêm chống hồi quy `closing_names` | 11 key, nhóm lớn nhất <=9; file test 4/4 pass |
| P0B.5 | DONE | Thêm fixture chỉ xuất hiện trong fallback/variant | Key chỉ-fallback/chỉ-variant có trong reachable; file test 5/5 pass |
| P0B.6 | DONE | Thêm test rotation âm và bounding box | `rotatedSlotBounds()` dùng trị tuyệt đối; targeted 29/29 pass |

### Pha 0C — Validator và biên canvas

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P0C.1 | DONE | Siết V4 về đúng biên preflight | Bốn cạnh + exact boundary + full-bleed regression xanh |
| P0C.2 | DONE | Kiểm bounding box sau rotation | Primitive + resolved look regression xanh; library/recipe hiện tại 0 offender |
| P0C.3 | DONE | Sửa comment và `meta.coordinateNote` | Metadata khóa x/y không âm và rotated bounds trong canvas |
| P0C.4 | DONE | Tạo `scripts/validateLayoutPrimitive.mjs` | Library 25 layout + candidate đơn chạy được; shape sai exit 1 |
| P0C.5 | DONE | Cài G1–G8, trong đó G5 chỉ warning | Library 25/25 pass; 0 error; 17 G5 + 3 G4 warning |
| P0C.6 | DONE | Chạy gate Pha 0 | Validator 25/25; lint 24/24; targeted 26/26; full typecheck xanh |

### Pha 1 — Thêm 7 primitive active

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P1.1 | DONE | Thêm frame preset `circleMedallion` | Radius 260, border 10, trắng, shadow; targeted 10/10 |
| P1.2 | DONE | Append 7 primitive vào cuối mảng `layouts` | Tổng 32; tail đúng 7 ID; bucket 1/2/3 = 7/8/9 |
| P1.3 | DONE | Validate library bằng G1–G8 | 32/32 pass, 0 error; G1–G3/G6–G8 sạch; 3 G4 + 17 G5 đều là baseline; 7 primitive mới có 0 finding |
| P1.4 | DONE | Chạy targeted tests | Geometry/layout/template 28/28 pass |
| P1.5 | DONE | Nâng ratchet `catalog.distinct` | Đo thực tế 56 và khóa `>=56`; authored 48; reachable maxShare/over12Count 23/7; targeted 28/28 |
| P1.6 | DONE | Dựng timeline probe 7 scene | 7 ID đúng thứ tự, mỗi primitive đúng một lần; 3 ảnh nguồn chung; dry-run 7/7 |
| P1.7 | DONE | Xoá scene cache và render probe | **Bằng chứng cũ lỗi thời**: probe nhiễu synthetic không thể lộ crop/chiều sâu; xem P1.7R |
| P1.7R | DONE | Nghiệm thu lại bằng 6 ảnh cưới thật và probe đọc trực tiếp library | Bản P1.7 cũ lỗi thời; sửa 4 primitive; validator 32/32, targeted 28/28, Premium không đổi |
| P1.8 | DONE | Chạy Premium dry-run sau thay đổi | Exit 0; STUB; 38/38 slide, 82/82 ảnh; `temp/premium-after.txt` SHA-256 `0A2DCB81...61E1AA8` |
| P1.9 | DONE | So sánh Premium trước/sau | Log chuẩn hoá 176/176 dòng và 38/38 scene signature giống nhau; ảnh/scene 1×0, 28×1, 9×6; 82 unique, 0 card 4/5 |
| P1.7R | DONE | **Chạy lại gate P1.7 bằng ảnh cưới thật** (bản 22:25 dùng ảnh nhiễu nên không thể fail) | `scripts/renderPrimitiveProbe.mjs` đọc thẳng library; 6 ảnh thật; bắt 4 lỗi thiết kế, đã sửa 4 layout; validator 32/32 + lint 24/24 + targeted 28/28 + metric 56/48/23/7 không đổi + Premium 176/176 dòng giống hệt. Chi tiết: [LAYOUT-PRIMITIVES-P1-REAUDIT.md](LAYOUT-PRIMITIVES-P1-REAUDIT.md) |

> ⚠️ `P1.7R` đổi toạ độ `stacked_horizon_trio`, `offset_portrait_hero`,
> `diagonal_staircase_trio` và thêm `frame` cho `overlap_stack_duo.front`.
> **46/69 entry trong `scripts/newPrimitiveAdoptionMap.json` đặt `layoutOverrides` lên bốn
> layout này và được suy ra từ hình học cũ** — riêng override của `stacked_horizon_trio`
> dựng lại đúng tỉ lệ cắt mặt vừa được sửa. Phiên sở hữu Pha 2A phải suy lại 46 override đó
> rồi chạy lại `--check-plan`. Xem §5 của bản nghiệm thu lại.

Primitive active:

- `overlap_stack_duo`
- `inset_card_hero`
- `circle_trio_stagger`
- `diagonal_staircase_trio`
- `golden_column_pair`
- `stacked_horizon_trio`
- `offset_portrait_hero`

Không thuộc Pha 1:

- `offset_quad_pinwheel`
- `filmstrip_band`

#### Ghi chú G4 grandfather cho `P1.3`

Gate `P1.3` ban đầu ghi "G1–G4 sạch". Số đo thực trên library 25 layout cho thấy gate đó
**không thể xanh như đã phát biểu**: validator đã chạy và báo 0 error nhưng có 20 warning,
trong đó **3 warning là G4** trên layout có sẵn từ trước Pha 0:

- `[caption] lies outside the 70px text safe margin` — 1 slot.
- `[body] lies outside the 70px text safe margin` — 2 slot.

Ba slot này không do Pha 0 tạo ra và việc dịch chúng vào lề sẽ đổi geometry, tức đụng ratchet
`authored.distinct >= 48`. `P0C.5` đã chọn cho G4 severity `warning` thay vì `error`, nên hiện
không có gì chặn chúng.

Quyết định: grandfather đúng 3 offender này và siết `P1.3` thành "không có offender G4 **mới**".
Bảy primitive Pha 1 phải sạch G4 tuyệt đối. Nếu số G4 vượt 3, gate `P1.3` fail.

Không hạ G4 xuống warning vĩnh viễn và không sửa 3 slot cũ trong Pha 1: sửa lề an toàn của
layout cũ là một thay đổi geometry riêng, phải đi kèm việc nâng lại ratchet, nên thuộc Pha 2
hoặc một pha dọn dẹp riêng.

### Pha 2A — Adoption planner

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P2A.1 | DONE | Tạo adoption map machine-readable | 23 recipe, 69 scene; source/target/override hợp lệ; mỗi primitive có 7–22 host |
| P2A.2 | DONE | Tạo `scripts/adoptNewPrimitives.mjs` | Guarded batch writer; 4 unit test + in-memory 23/69 resolve sạch |
| P2A.3 | DONE | Cài `--check-plan` in-memory, không ghi file | 23 recipe / 69 adoption; SHA-256 24 recipe không đổi |
| P2A.4 | DONE | Report mọi occurrence của 7 key quá rộng | 7 group; 161 occurrence = 100 main + 21 fallback + 40 variant |
| P2A.R1 | DONE | Rebase map/guard/tài liệu theo hình học P1.7R | 70 adoption; guard xanh; simulated maxShare 12 / over12 0 |
| P2A.5 | DONE | Kiểm photo demand và union text key | 72 execution path; 1 union text key; không mất ảnh hoặc copy |
| P2A.6 | DONE | Kiểm gallery-tail toàn cục | 24/24 chuỗi `s83 > s84 > s85` duy nhất |
| P2A.7 | DONE | Kiểm mỗi primitive có >=2 host | 7 primitive đạt 2–22 recipe host; Pha 1b = 0 |
| P2A.8 | DONE | Mô phỏng đồng thời sáu recipe chỉ có 3 ứng viên | 6/6 dùng đủ tail và không xung đột |
| P2A.R2 | DONE | Nghiệm thu lại toàn bộ Pha 2A trên cây mô phỏng | 4 lỗi chặn rollout đã sửa; `--check-plan` chạy được sau khi ghi batch; ghi thử pilot → 28/28 committed test xanh → khôi phục |

#### Bốn lỗi `P2A.R2` tìm ra và đã sửa

Toàn bộ bằng chứng "xanh" của P2A.1–P2A.8 (`lint 24/24`, `validator 32/32`, `targeted 42/42`) được đo
trên **cây nguồn chưa migrate**. Chạy lại đúng các gate đó trên cây **sau adoption** lộ ra bốn vấn đề:

1. **`--check-plan` không idempotent.** `applyRecipePlan()` bắt buộc `scene.look === source.look`,
   nên ngay sau khi batch đầu được ghi, gate số 1 của mọi batch còn lại throw. Đã sửa: adoption đã
   ghi thì đi nhánh verify (đúng primitive, đúng override, không mang field lạ, slot id khớp).
   Bằng chứng: ghi thật batch `pilot` rồi chạy lại `--check-plan` → `61 pending, 9 already applied`.
2. **Batch pilot làm đỏ một test đã commit.** `cinematic-film-01/s83_gallery_matte` resolve
   `background {"type":"tint","color":"#D8CFC0"}` nhờ `layoutOverrides.background` của look
   `film_gallery`; whitelist ba trường của look đích bỏ nó, nền thành `cream`, và
   `test/template-recipes.test.mjs` → `cinematic gallery keeps portrait-safe contain crops on a light
   matte` deepEqual đúng giá trị đó. Đã sửa: map mang background sang look đích, và content audit từ
   nay từ chối mọi look field bị bỏ ngoài chính sách (`frame` trên primitive sở hữu frame).
3. **14/143 slot đảo hướng do ghép request↔slot theo index**, trong đó 2 là request ghi rõ
   `orient: "portrait"` rơi vào slot landscape (`jmii-silk-botanical-01/s11_side_by_side` →
   `golden_column_pair.major`, `four-seasons-love-01/s03_autumn` → `diagonal_staircase_trio.mid`).
   Guard hướng ảnh trước đó chỉ tồn tại cho `stacked_horizon_trio`. Đã sửa: guard tổng quát; hai ca
   cứng được sửa bằng map (`major` thu còn 940px → vuông; `s03_autumn` chuyển sang
   `circle_trio_stagger` slot vuông); 11 slot `orient: "any"` còn lại phải ký nhận
   `accepts: ["orientation"]`.
4. **Map tạo composition trùng xuyên recipe đầu tiên của catalogue.** `cinematic-film-01`,
   `jmii-silk-botanical-01` và `classic-multisong-album-01` cùng khai `circle_trio_stagger` với
   override giống hệt `{p2:{y:250}}`; vì primitive này sở hữu frame nên không recipe nào giữ được
   frame riêng, ba scene ra cùng một `visualSignature`. Trước migration catalogue có **0** cặp dùng
   chung composition. Không gate nào bắt: bar committed là 1/3 (đo được 8%), còn `galleryTailAudit`
   so cả chuỗi ba scene. Đã sửa: mỗi entry một override riêng, và thêm audit giữ mức 0.

**Một lỗi Pha 1 lộ ra khi chạy `npm run test:unit`.** `diagonal_staircase_trio.heading` (do P1.7R dời
tới `1210,75 620×180`) có mép phải ở 1830, vượt lề title-safe 5% (1824) đúng 6px, làm đỏ
`test/tier1-quality.test.mjs` → `every library text slot sits inside the 5% title-safe margin`. Nó
không bị bắt vì `G4` của validator dùng lề **70px** (1850) còn test dùng **5% = 96px**, và P1.7R chỉ
chạy targeted tests chứ không chạy `test:unit`. Đã sửa `width` 620 → 614; `test:unit` 375/375.
Bài học cho các bước sau: **validator xanh không thay thế được `test:unit`**, và hai luật lề an toàn
trong repo đang lệch nhau — đáng hợp nhất ở một pha dọn dẹp riêng.

Ngoài ra `--check-plan` giờ assert mục tiêu Pha 2 trên cây mô phỏng (trước đây chỉ in report của cây
nguồn; mục tiêu chỉ được khoá trong `test/adopt-new-primitives.test.mjs`), lint authoring-rules chạy
trên cây mô phỏng, nhánh `--write` chạy đúng bộ gate của nhánh kiểm, và cohort sáu recipe chuyển từ
hằng số trong script vào `map.constrainedCohort`.

Một ghi chú về phạm vi, không phải lỗi: 64/70 adoption nằm ở đuôi gallery `s83/s84/s85`, chỉ 6 chạm
story beat thật. 20 trên 23 recipe đạt sàn "≥3 scene meaningful" hoàn toàn bằng phần đuôi. Đã ghi vào
plan §7.3.

Gate P2A.5 cũng cần đọc đúng mức: trong 70 scene được adopt chỉ có **1** scene mang `scene.text` và
**1** scene có `repeatable`; không scene nào có `muteFallback`. Con số "72 execution path, 1 union
text key" là đúng nhưng chỉ chạm một scene, nên nó không chứng minh được gì nhiều về an toàn copy.

### Pha 2B — Pilot ba recipe

| Recipe | Trạng thái | Yêu cầu | Kết quả đo |
|---|---|---|---|
| `cinematic-film-01` | DONE | 3 scene meaningful; gồm `offset_portrait_hero` | meaningful `1 -> 3`; `s83_gallery_matte` → `offset_portrait_hero`, giữ nền `#D8CFC0` |
| `jmii-silk-botanical-01` | DONE | 3 scene meaningful; frame tròn đúng radius nếu resize | meaningful `3 -> 6`; không resize slot tròn nên `circleMedallion` r=260 vẫn đúng nửa cạnh 520 |
| `editorial-bold-01` | DONE | 3 scene meaningful; không dùng `s03_chapter` sai text contract | meaningful `0 -> 3`; map không có adoption nào ở `s03_chapter` |

Sau pilot:

- Chạy lại `--check-plan` trên toàn bộ adoption map — `61 pending, 9 already applied`.
- Nâng ratchet đúng ba recipe đã migrate — `3 / 6 / 3`, `white-weddings-full-01` giữ `1`.
- Chỉ hạ `maxShare/over12Count` tới số đo thực tế — `23 -> 22` và `7 -> 6`, không phải mục tiêu `12/0`.
- Commit pilot độc lập — `8161779`.

#### Bộ test planner phải sống được qua cả sáu batch

`P2A.R2` đã sửa `--check-plan` cho cây nửa migrate, nhưng bằng chứng của nó chỉ chạy
`test/template-recipes.test.mjs` sau khi ghi thử pilot. Ghi pilot thật làm đỏ **11/21** test trong
`test/adopt-new-primitives.test.mjs`, và `test:unit` glob `test/*.test.mjs` nên `npm run check` đỏ
theo. Hai nhóm nguyên nhân, đều là "đo trên cây chưa migrate":

1. **Kỳ vọng chốt cứng trạng thái nguồn**: `72 execution path`, `70 pending, 0 already applied`,
   share `[23,15,15,14,14,13,13]`, `adoptionStatus(...) === "pending"`, và một assert "input recipe
   was mutated" so với `["left","right"]` — tức so với chính hình dạng mà pilot vừa đổi. Đã sửa
   bằng cách suy kỳ vọng từ `adoptionStatus()` trên cây hiện tại thay vì chốt số.
2. **Fixture sửa plan rồi áp lên recipe thật**: khi recipe đã ghi, plan bị sửa không còn khớp file,
   nên `verifyAppliedAdoption()` throw trước và audit cần kiểm không bao giờ chạy. Đã sửa bằng
   `test/fixtures/pre-adoption-recipes.json` — bản đóng băng của 6 recipe tại commit `6538338`
   (trước batch đầu tiên), luôn ở trạng thái `pending`. Một test giữ cho bản đóng băng khỏi mục:
   mọi adoption của map phải `pending` với nó và `source.layout` phải khớp.

Quét thêm ba lỗi **chưa nổ ở pilot nhưng sẽ nổ ở batch sau**, đã sửa cùng lúc:

- fixture `undeclared` dùng `modern-teal-01` → sẽ đỏ ở `B4`;
- fixture `collided` dùng `classic-multisong-album-01` → sẽ đỏ ở `B2`;
- assert "cây nguồn là thứ gate phải từ chối" → sẽ đỏ ngay khi `B5` xong, vì lúc đó cây nguồn
  **chính là** cây đích. Thay bằng một cây có đúng một recipe bị bỏ lại ở hình học pre-adoption.

Ngoài ra `Orientation contract` và report `Widespread reachable geometry` đều rỗng dần theo rollout
(`declaredDriftCount` chỉ đếm adoption `pending`; report chỉ in group `share > 12`), nên hai test đó
chuyển sang khoá thứ bất biến: map ký nhận đúng `7` adoption bẻ hướng ảnh, sáu recipe đóng băng khai
`3` shape change, và formatter được kiểm bằng stats fixture tự dựng.

Nghiệm thu: chạy `test/adopt-new-primitives.test.mjs` ở **cả bảy giai đoạn** rollout
(pristine → pilot → B1 → B2 → B3 → B4 → B5) — `22/22` pass ở mọi giai đoạn.

**Việc còn nợ, không chặn rollout.** Writer sinh `intent` máy móc cho look mới
(`"Phase 2 adoption of <primitive> for <sceneId>."`). Nó là tài liệu cho người đọc recipe, không
ảnh hưởng hình học và không đụng `compositionUniquenessAudit` (vẫn 0 cặp dùng chung), nhưng hai
recipe cùng adopt một primitive ở cùng scene id sẽ có `intent` giống hệt nhau. Nếu muốn giữ giọng
tự viết của recipe thì thêm `intent` cho từng adoption trong map — 70 dòng, nên làm thành một bước
riêng chứ không nhét vào một batch.

### Pha 2C — Rollout theo batch

| Batch | Recipe | Trạng thái | Commit |
|---|---|---|---|
| B1 | `afterparty-pulse-01`, `cinematic-vows-01`, `city-to-ceremony-01`, `classic-luxury-01` | DONE | `161b281` |
| B2 | `classic-multisong-album-01`, `family-roots-01`, `four-seasons-love-01`, `garden-botanical-01` | DONE | `4cf6f25` |
| B3 | `garden-diary-01`, `heritage-ceremony-01`, `korean-soft-01`, `letters-to-forever-01` | DONE | `0b42562` |
| B4 | `long-distance-love-01`, `luminous-editorial-motion-01`, `modern-teal-01`, `playful-scrapbook-01` | DONE | `2294cac` |
| B5 | `studio-white-prewedding-01`, `three-chapters-biography-01`, `warm-film-01`, `white-weddings-editorial-01` | DONE | `B5_SHA` |

Gate bắt buộc sau mỗi batch:

1. `adoptNewPrimitives.mjs --check-plan` xanh.
2. Bốn recipe vừa migrate đạt ít nhất 3 scene meaningful.
3. Photo demand và union text key không đổi.
4. Gallery-tail toàn cục vẫn duy nhất.
5. Ratchet chỉ được siết theo số đo mới.
6. Targeted tests và lint xanh.
7. Ghi commit SHA vào bảng.

Ngoại lệ:

| Recipe | Trạng thái | Yêu cầu |
|---|---|---|
| `white-weddings-full-01` | DONE | Không nhận primitive mới; giữ ratchet meaningful `>=1`. Nghiệm thu sau B5: `0` adoption trong map, meaningful vẫn đúng `1` |

### Pha 2D — Nghiệm thu và tài liệu

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P2D.1 | TODO | Chạy nghiệm thu metric cuối | `maxShare <=12`, `over12Count=0` |
| P2D.2 | TODO | Chạy lint toàn bộ recipe | 24/24 clean |
| P2D.3 | TODO | Chạy targeted geometry/layout/template tests | Tất cả xanh |
| P2D.4 | TODO | Chạy `npm run preview:tier1` trên ít nhất 2 job thật | Không tụt về Lite |
| P2D.5 | TODO | Cập nhật `docs/generation-guide.md` | Mô tả 7 primitive active |
| P2D.6 | TODO | Cập nhật `docs/TEMPLATE-RULES.md` nếu có luật mới | Docs phản ánh validator mới |
| P2D.7 | TODO | Chạy `npm run docs:check` | Xanh |
| P2D.8 | TODO | Chạy `npm run check` trên worktree sạch | Gate merge cuối phải xanh |

### Pha 3 — Radius bốn góc và arch thật, tuỳ chọn

Chỉ bắt đầu sau khi Pha 1 ổn định. Pha này không chặn mục tiêu Pha 0–2.

| ID | Trạng thái | Công việc | Gate / bằng chứng |
|---|---|---|---|
| P3.1 | TODO | Mở rộng `LayerFrame.radius` thành number hoặc tuple 4 góc | Typecheck xanh; number giữ hành vi cũ |
| P3.2 | TODO | Mở rộng zod và validator radius | Kiểm từng góc và tổng radius kề |
| P3.3 | TODO | Sửa mask renderer cho bốn góc | Radius 0 giữ alpha nguyên |
| P3.4 | TODO | Thêm preset `arch` và `arch_window_trio` | Arch thật, không phải rounded rectangle |
| P3.5 | TODO | Thêm test command và alpha pixel | Test được nối vào `test:api` |
| P3.6 | TODO | Benchmark render trước/sau | Nếu chậm >20%, chuyển sang PNG mask + alphamerge |
| P3.7 | TODO | Chạy typecheck, `test:api` và `npm run check` | Tất cả xanh |

## 5. Các lệnh kiểm chứng chuẩn

### Sau Pha 0 và mỗi batch Pha 2

```powershell
node scripts/validateLayoutPrimitive.mjs layouts/library.json
node scripts/lintStoryTemplates.mjs
node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs
npm run typecheck
```

### Gate merge cuối

```powershell
npm run check
```

### Probe hình ảnh Pha 1

```powershell
Remove-Item -Recurse -Force temp/scene-cache
npm run render -- temp/probe-primitives.json
```

### Premium trước/sau

```powershell
npm run premium -- --project <job> --dry-run > temp/premium-before.txt
npm run premium -- --project <job> --dry-run > temp/premium-after.txt
```

## 6. Bằng chứng thực hiện

| Mốc | Commit | Test / metric | Artefact | Trạng thái |
|---|---|---|---|---|
| Baseline sạch | `d5e8d0f` (snapshot đã commit; parent `82d59a5`) | `npm run check`: exit 0; API 74/74; unit 340/340; integration 1/1; audit 0 vulnerability | Worktree `D:\Claude\Projects\SlideshowRenderEngine-layout-primitives` | DONE |
| Pha 0 metric/validator | `b83d601`, refactor `e43dad3` | P0A–P0C hoàn tất; validator 25/25 (0 error, 20 warning), lint 24/24, targeted 53/53, `test:unit` 352/352, full typecheck xanh | `scripts/lib/geometrySignature.mjs`; `scripts/lib/lookResolver.mjs`; `scripts/validateLayoutPrimitive.mjs`; targeted tests | DONE |
| Pha 1 primitives | `5871122` | P1.1–P1.9 hoàn tất: library 32 layout, catalog V2 56, targeted 28/28, probe render/review và Premium comparison đều đạt | `layouts/library.json`; targeted tests; probe/Premium artefact | DONE |
| Pha 1 visual probe | `5871122` | Render mới 7/7 scene; H.264 1920x1080, 30 fps, 36,466667 giây; review đủ 7 layout và 28 frame mở đầu/ổn định/xfade đạt | `temp/probe-primitives.json` SHA-256 `90D07EE0...F8DA2E8`; `temp/probe-primitives.mp4` SHA-256 `44D7325E...1721ED9` | DONE |
| Pha 1 Premium comparison | `5871122` | Log chuẩn hoá 176/176 dòng, 38/38 `scene|duration|renderer` và 3/3 warning giống nhau; before/after cùng 38 scene, 82/82 ảnh, 188.83s; phân bố ảnh/scene 1×0, 28×1, 9×6; 0 card 4/5 | `temp/premium-before.txt` SHA-256 `3549F96C...DBD883`; `temp/premium-after.txt` SHA-256 `0A2DCB81...61E1AA8`; canonical render SHA-256 `542E6923...5F099E0` | DONE |
| Pha 2 adoption planner | `4ac137c` | P2A.1–P2A.8 + P2A.R2 hoàn tất. Trên cây mô phỏng: `reachable.maxShare=12`, `over12=0`, lint `24/24`, 253 composition với 0 cặp recipe dùng chung, orientation 0 lỗi cứng / 11 shape change đã ký nhận, meaningful ≥3 (ww-full=1). Adoption test `21/21`; targeted geometry/library/template `28/28`; validator `32/32`; `typecheck:scripts` xanh. Ghi thử batch `pilot` rồi chạy lại `--check-plan` → `61 pending, 9 already applied`, committed test `28/28` xanh, sau đó khôi phục `story-templates/` | `scripts/newPrimitiveAdoptionMap.json`; `scripts/adoptNewPrimitives.mjs`; `test/adopt-new-primitives.test.mjs` | DONE |
| Pha 2 pilot | `8161779` | 9 adoption / 3 recipe. Đo thật sau ghi: `catalog 56 -> 64`, `authored 48 -> 56`, `maxShare 23 -> 22`, `over12 7 -> 6`, meaningful `cinematic 1 -> 3`, `editorial 0 -> 3`, `jmii 3 -> 6`, `ww-full` giữ `1`. `--check-plan` `61 pending, 9 already applied`; validator `32/32` (0 error, 20 warning baseline); lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0; `npm run test:unit` `376/376`. Bộ adoption test chạy `22/22` ở cả 7 giai đoạn rollout | `story-templates/{cinematic-film-01,editorial-bold-01,jmii-silk-botanical-01}.json`; `test/fixtures/pre-adoption-recipes.json`; `test/adopt-new-primitives.test.mjs`; `test/layout-geometry.test.mjs` | DONE |
| Pha 2 batch B1 | `161b281` | 12 adoption / 4 recipe. Đo thật sau ghi: `catalog 64 -> 76`, `authored 56 -> 68`, `shared 30 -> 30`, `maxShare 22 -> 18`, `over12 6 -> 4`; cả 4 recipe meaningful `0 -> 3`. `--check-plan` `49 pending, 21 already applied`; content contract `51 path / 1 union text key`; gallery-tail `24/24`; composition `253 / 0 dùng chung`; validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0; `test:unit` `376/376` | `story-templates/{afterparty-pulse-01,cinematic-vows-01,city-to-ceremony-01,classic-luxury-01}.json`; `test/layout-geometry.test.mjs` | DONE |
| Pha 2 batch B2 | `4cf6f25` | 13 adoption / 4 recipe. Đo thật sau ghi: `catalog 76 -> 89`, `authored 68 -> 81`, `shared 30 -> 30`, `maxShare 18 -> 15`, `over12 4 -> 2`; meaningful `3/3/4/3`. `--check-plan` `36 pending, 34 already applied`; content contract `36 path / 0 union text key`; gallery-tail `24/24`; composition `253 / 0 dùng chung`; validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0; `test:unit` `376/376` | `story-templates/{classic-multisong-album-01,family-roots-01,four-seasons-love-01,garden-botanical-01}.json`; `test/layout-geometry.test.mjs` | DONE |
| Pha 2 batch B3 | `0b42562` | 12 adoption / 4 recipe. Đo thật sau ghi: `catalog 89 -> 101`, `authored 81 -> 93`, `shared 30 -> 30`, `maxShare 15 -> 13`, `over12 2 -> 1`; cả 4 recipe meaningful `0 -> 3`. `--check-plan` `24 pending, 46 already applied`; content contract `24 path / 0 union text key`; gallery-tail `24/24`; composition `253 / 0 dùng chung`; validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0; `test:unit` `376/376` | `story-templates/{garden-diary-01,heritage-ceremony-01,korean-soft-01,letters-to-forever-01}.json`; `test/layout-geometry.test.mjs` | DONE |
| Pha 2 batch B4 | `2294cac` | 12 adoption / 4 recipe. Đo thật sau ghi: `catalog 101 -> 113`, `authored 93 -> 105`, `shared 30 -> 30`, **`maxShare 13 -> 12`**, **`over12 1 -> 0`**; cả 4 recipe meaningful `0 -> 3`. Hai mục tiêu hình học cuối của plan đã đạt. `--check-plan` `12 pending, 58 already applied`; content contract `12 path`; gallery-tail `24/24`; composition `253 / 0 dùng chung`; validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0; `test:unit` `376/376` | `story-templates/{long-distance-love-01,luminous-editorial-motion-01,modern-teal-01,playful-scrapbook-01}.json`; `scripts/newPrimitiveAdoptionMap.json`; `test/layout-geometry.test.mjs` | DONE |
| Pha 2 batch B5 | `B5_SHA` | 12 adoption / 4 recipe; **rollout hoàn tất**. Đo thật sau ghi: `catalog 113 -> 125`, `authored 105 -> 117`, `shared 30 -> 30`, `maxShare 12`, `over12 0`; cả 4 recipe meaningful `0 -> 3`. `--check-plan` `0 pending, 70 already applied` và `Widespread reachable geometry: 0 group(s)`; gallery-tail `24/24`; composition `253 / 0 dùng chung`; validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0; `test:unit` `376/376` | `story-templates/{studio-white-prewedding-01,three-chapters-biography-01,warm-film-01,white-weddings-editorial-01}.json`; `test/layout-geometry.test.mjs` | DONE |
| Nghiệm thu cuối | — | — | — | TODO |
| Pha 3 tuỳ chọn | — | — | — | TODO |

## 7. Nhật ký bàn giao

### 2026-07-31 — P2C batch B5 (rollout hoàn tất)

- Session: Claude, theo yêu cầu "làm B5 + 2D sau đó merge".
- Trạng thái nhận việc: `IN_PROGRESS`; cây sạch tại `4be96f5`.
- Phạm vi: ghi batch cuối `B5`, chạy đủ 7 gate, siết ratchet tới số đo, commit độc lập.
- File đã thay đổi:
  - `story-templates/studio-white-prewedding-01.json`, `three-chapters-biography-01.json`,
    `warm-film-01.json`, `white-weddings-editorial-01.json` — do `--write --batch B5` ghi.
  - `test/layout-geometry.test.mjs` — siết ratchet lần cuối.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Bảy gate của Pha 2C:
  1. `--check-plan` xanh — `0 pending, 70 already applied`, và
     `Widespread reachable geometry: 0 group(s)`.
  2. Cả bốn recipe meaningful `0 -> 3`.
  3. Content contract `0 execution path` — không còn adoption đang chờ để so; mọi đường chạy đã
     được kiểm ở đúng batch ghi nó.
  4. Gallery-tail `24/24` duy nhất; composition `253` với `0` cặp dùng chung.
  5. Ratchet: `catalog >= 125`, `authored >= 117`, `maxShare <= 12`, `over12Count === 0`,
     `shared <= 30`; bốn recipe B5 khoá ở `3`.
  6. Validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0;
     `npm run test:unit` `376/376`.
  7. Commit `B5_SHA`.
- Trạng thái cuối của catalogue: 23 recipe tự do đều `>=3` scene meaningful
  (`four-seasons-love-01` `4`, `jmii-silk-botanical-01` `6`, còn lại `3`);
  `white-weddings-full-01` giữ đúng `1` và không nhận adoption nào.
- Metric trước/sau: `catalog 113 -> 125`, `authored 105 -> 117`, `authored.shared 30 -> 30`,
  `maxShare 12`, `over12 0`.
- Commit: `B5_SHA`.
- Quyết định hoặc sai lệch so với plan: Không có.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2D` — P2D.1–P2D.3 đã xanh ngay trong gate của B5; còn P2D.4 `preview:tier1`
  trên 2 job thật, P2D.5/P2D.6 cập nhật docs, P2D.7 `docs:check`, P2D.8 `npm run check`.

### 2026-07-31 — P2C batch B4

- Session: Claude, theo yêu cầu "Làm B4".
- Trạng thái nhận việc: `IN_PROGRESS`; cây sạch tại `8abcebd`.
- Phạm vi: ghi batch `B4`, chạy đủ 7 gate, siết ratchet tới số đo, commit độc lập. Phải mở rộng
  sang `scripts/newPrimitiveAdoptionMap.json` vì batch này lộ ra một lỗi map — xem bên dưới.
- File đã thay đổi:
  - `story-templates/long-distance-love-01.json`, `luminous-editorial-motion-01.json`,
    `modern-teal-01.json`, `playful-scrapbook-01.json` — do `--write --batch B4` ghi.
  - `scripts/newPrimitiveAdoptionMap.json` — sửa override trùng của `modern-teal-01/s85_arch_trio`.
  - `test/layout-geometry.test.mjs` — siết ratchet + thêm bar mới cho `authored.shared`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- **Hai mục tiêu hình học cuối của plan đã đạt ở batch này**: `reachable.maxShare = 12` và
  `reachable.over12Count = 0`. B5 không cần hạ thêm; nó chỉ còn nhiệm vụ đưa 4 recipe cuối lên sàn
  meaningful `>=3`.

#### Lỗi B4 tìm ra: hai recipe vẽ cùng một hình, audit không bắt

`authored.shared` là metric **duy nhất trong cả rollout đi sai hướng**: giữ `30` suốt
pilot→B1→B2→B3, rồi nhảy `31` ngay khi ghi B4. Truy ra một group mới có `share=2`:

- `heritage-ceremony-01/s85_arch_trio` (ghi ở B3)
- `modern-teal-01/s85_arch_trio` (ghi ở B4)

Cả hai vào `diagonal_staircase_trio` với `layoutOverrides` **giống hệt từng byte**:
`{"photoSlots":{"top":{"x":70},"low":{"x":1190}}}`. Chín adoption `diagonal` còn lại đều có
override riêng; đúng hai entry này trùng nhau.

Đây chính là **bug #4 của P2A.R2 tái diễn** ở dạng mà audit nó dựng ra không thấy:
`compositionUniquenessAudit()` vẫn báo `0 cặp dùng chung` vì composition signature tính cả `frame`,
mà hai recipe này khác frame (`lacquer_frame` vs `edge_soft`) và heritage còn có `photoTreatment`.
Nhưng `frame` là **lớp áo, không phải hình học** — V2 geometry key chỉ tính rect + background, và
theo thước đó hai scene vẽ ba khung hình y hệt nhau ở cùng vị trí, cùng scene id.

Đã sửa hai việc:

1. `modern-teal-01/s85_arch_trio` nhận override riêng
   `{"top":{"x":70,"y":90},"low":{"x":1190,"y":490}}` — đường chéo nén lại, hợp chất tối giản của
   recipe. Sửa modern-teal chứ không sửa heritage vì heritage đã commit ở B3; đổi map của nó sẽ làm
   `--check-plan` fail verification trên file đã ghi. Giữ nguyên slot `620x500`, coverage `44.8%`,
   base `x=90/650/1210` theo guard P1.7R §7.2. Sau khi sửa: `shared` về `30`, và vì có thêm một key
   phân biệt nên `catalog 112 -> 113`, `authored 104 -> 105`.
2. Thêm bar `authored.shared <= 30` vào `test/layout-geometry.test.mjs`. Nghiệm thu bằng cách khôi
   phục lại override trùng rồi chạy lại: test **fail** đúng như mong đợi, sau đó khôi phục bản sửa.

Bài học ghi lại cho B5 và Pha 2D: **`compositionUniquenessAudit` xanh không có nghĩa là hình học
không trùng.** Nó tính cả dressing; muốn kiểm hình học thuần thì đọc `authored.shared`.

- Bảy gate của Pha 2C:
  1. `--check-plan` xanh — `12 pending, 58 already applied`.
  2. Cả bốn recipe meaningful `0 -> 3`.
  3. Content contract `12 execution path`; photo demand và copy giữ nguyên.
  4. Gallery-tail `24/24` duy nhất; composition `253` với `0` cặp dùng chung.
  5. Ratchet siết tới số đo: `catalog >= 113`, `authored >= 105`, `maxShare <= 12`,
     `over12Count === 0` (đổi từ `<=` sang `===` vì đã chạm đáy), `shared <= 30`.
  6. Validator `32/32`; lint `24/24`; targeted `50/50`; `typecheck:scripts` exit 0;
     `npm run test:unit` `376/376`.
  7. Commit `2294cac`.
- Metric trước/sau: `catalog 101 -> 113`, `authored 93 -> 105`, `authored.shared 30 -> 30`,
  `maxShare 13 -> 12`, `over12 1 -> 0`.
- Commit: `2294cac`.
- Quyết định hoặc sai lệch so với plan:
  - Sửa map nằm ngoài mô tả gốc của một batch. Lý do: lỗi do chính batch này tạo ra, là metric duy
    nhất đi sai hướng, và để lại thì Pha 2D sẽ nghiệm thu trên một catalogue có hai recipe vẽ trùng.
  - `over12Count` khoá bằng `=== 0` thay vì `<= 0` để nói rõ đây là đáy, không phải trần tạm.
- Ghi chú vận hành: sau khi `git checkout -- story-templates` rồi ghi lại các batch, `git status`
  hiện 20 file `M` nhưng `git diff --numstat` chỉ có 4 — 16 file kia là stat-cache cũ do
  autocrlf, nội dung không đổi. Kiểm bằng `git diff --numstat`, đừng tin `git status` ở bước này.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2C batch B5` — `studio-white-prewedding-01`, `three-chapters-biography-01`,
  `warm-film-01`, `white-weddings-editorial-01`. Đây là batch cuối; sau nó `--check-plan` sẽ báo
  `0 pending, 70 already applied` và `Orientation contract` về `0` declared — cả hai đều đúng, đã
  nghiệm thu ở P2B khi quét 7 giai đoạn.

### 2026-07-31 — P2C batch B3

- Session: Claude, theo yêu cầu "tiếp tục".
- Trạng thái nhận việc: `IN_PROGRESS`; cây sạch tại `846199c`.
- Phạm vi: ghi batch `B3`, chạy đủ 7 gate, siết ratchet tới số đo, commit độc lập. Không đụng
  `layouts/library.json`, `scripts/`, hay recipe ngoài bốn recipe B3.
- File đã thay đổi:
  - `story-templates/garden-diary-01.json`, `heritage-ceremony-01.json`, `korean-soft-01.json`,
    `letters-to-forever-01.json` — do `--write --batch B3` ghi.
  - `test/layout-geometry.test.mjs` — siết ratchet.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - 12 adoption trên 4 recipe; diff `216 insertions / 104 deletions`.
  - Ratchet siết tới số **đo được**: `catalog >= 101`, `authored >= 93`, `maxShare <= 13`,
    `over12Count <= 1`; bốn recipe B3 khoá ở `3`.
- Bảy gate của Pha 2C:
  1. `--check-plan` xanh — `24 pending, 46 already applied`.
  2. Cả bốn recipe meaningful `0 -> 3`.
  3. Content contract `24 execution path / 0 union text key`; photo demand và copy giữ nguyên.
  4. Gallery-tail `24/24` duy nhất; composition `253` với `0` cặp dùng chung.
  5. Ratchet chỉ siết tới số đo mới.
  6. Validator `32/32` (0 error, 20 warning baseline); lint `24/24`; targeted `50/50`;
     `typecheck:scripts` exit 0; `npm run test:unit` `376/376`.
  7. Commit `0b42562` ghi vào bảng Pha 2C và bảng §6.
- Trạng thái mục tiêu sau B3: chỉ còn **đúng một** group trên trần 12 — `three_photo_row`
  ở share `13`. `gallery_matte_hero`, group nặng nhất của baseline (share 23), đã xuống dưới trần.
  Group cuối này rơi khi các recipe còn lại nhận đủ đuôi ở B4/B5.
- Metric trước/sau: `catalog 89 -> 101`, `authored 81 -> 93`, `authored.shared 30 -> 30`,
  `maxShare 15 -> 13`, `over12 2 -> 1`.
- Commit: `0b42562`.
- Quyết định hoặc sai lệch so với plan: Không có. Từ B3 trở đi mọi adoption đều nằm ở đuôi gallery
  `s83/s84/s85`, không còn story beat nào, nên không có ca cần đo tay ngoài gate như B1/B2.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2C batch B4` — `long-distance-love-01`, `luminous-editorial-motion-01`,
  `modern-teal-01`, `playful-scrapbook-01`. `modern-teal-01` nằm trong
  `test/fixtures/pre-adoption-recipes.json` và là recipe mang cả 3 declared shape change còn lại,
  nên sau B4 `Orientation contract` sẽ về `0` — đó là hành vi đúng, không phải mất guard.

### 2026-07-31 — P2C batch B2

- Session: Claude, theo yêu cầu "chạy B2".
- Trạng thái nhận việc: `IN_PROGRESS`; cây sạch tại `5ad9fe3`.
- Phạm vi:
  - Ghi batch `B2`, chạy đủ 7 gate của Pha 2C, siết ratchet tới số đo thực tế, commit độc lập.
  - Không đụng `layouts/library.json`, `scripts/`, hay recipe ngoài bốn recipe B2.
- File đã thay đổi:
  - `story-templates/classic-multisong-album-01.json`, `family-roots-01.json`,
    `four-seasons-love-01.json`, `garden-botanical-01.json` — do `--write --batch B2` ghi.
  - `test/layout-geometry.test.mjs` — siết ratchet.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - 13 adoption trên 4 recipe (batch duy nhất có 13); diff `245 insertions / 113 deletions`.
  - Ratchet siết tới số **đo được**: `catalog >= 89`, `authored >= 81`, `maxShare <= 15`,
    `over12Count <= 2`; meaningful `classic-multisong 3`, `family-roots 3`,
    `four-seasons 4`, `garden-botanical 3`.
- Bảy gate của Pha 2C:
  1. `--check-plan` xanh — `36 pending, 34 already applied`.
  2. Meaningful `0 -> 3 / 3 / 4 / 3`. `four-seasons` được `4` vì nó có adoption thứ tư ngoài đuôi.
  3. Content contract `36 execution path / 0 union text key`; photo demand và copy giữ nguyên.
  4. Gallery-tail `24/24` duy nhất; composition `253` với `0` cặp dùng chung.
  5. Ratchet chỉ siết tới số đo mới.
  6. Validator `32/32` (0 error, 20 warning baseline); lint `24/24`; targeted `50/50`;
     `typecheck:scripts` exit 0; `npm run test:unit` `376/376`.
  7. Commit `4cf6f25` ghi vào bảng Pha 2C và bảng §6.
- Kiểm thêm ngoài gate: `four-seasons-love-01/s03_autumn` là adoption **story-beat cuối cùng mang
  copy** trong cả map, và là entry P2A.R2 phải đổi mục tiêu vì hướng ảnh. Đo trực tiếp trên cây đã
  ghi: nó vào `circle_trio_stagger`, request `any/portrait/any`, slot `p2` là `520x520` **vuông**
  nên request portrait không rơi vào lỗ landscape; cả ba slot giữ `circleMedallion` r=260 = đúng
  nửa cạnh; `heading` có slot đích và có mặt trên **cả ba** đường chạy (main + 2 repeat variant),
  nên không mất chữ.
- Vì sao `union text key` tụt `1 -> 0`: `s03_autumn` chính là scene duy nhất trong 70 adoption mang
  `scene.text`, và nó vừa được ghi. Con số 0 nghĩa là "không còn adoption *đang chờ* nào mang chữ",
  không phải "chữ biến mất" — copy của nó đã được kiểm ở trên.
- Metric trước/sau: `catalog 76 -> 89`, `authored 68 -> 81`, `authored.shared 30 -> 30`,
  `maxShare 18 -> 15`, `over12 4 -> 2`.
- Commit: `4cf6f25`.
- Quyết định hoặc sai lệch so với plan:
  - Siết `four-seasons-love-01` lên `4` chứ không phải `3`, theo quy ước §2.8 chỉ siết tới số đo.
- Ghi chú đọc số: `family-roots-01/s84_photo_duo` báo coverage `110.8%` — cùng lý do full-bleed
  `bg` của `inset_card_hero` như đã ghi ở B1, không phải tràn canvas.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2C batch B3` — `garden-diary-01`, `heritage-ceremony-01`, `korean-soft-01`,
  `letters-to-forever-01`. Từ B3 trở đi mọi adoption còn lại đều nằm ở đuôi gallery `s83/s84/s85`;
  hai group còn trên trần là `gallery_matte_hero` (share 15) và `three_photo_row` (share 14).

### 2026-07-31 — P2C batch B1

- Session: Claude, theo yêu cầu "làm bước tiếp theo".
- Trạng thái nhận việc: `IN_PROGRESS`; cây sạch tại `87da4e2`.
- Phạm vi:
  - Ghi batch `B1`, chạy đủ 7 gate của Pha 2C, siết ratchet tới số đo thực tế, commit độc lập.
  - Không đụng `layouts/library.json`, `scripts/`, hay recipe ngoài bốn recipe B1.
- File đã thay đổi:
  - `story-templates/afterparty-pulse-01.json`, `cinematic-vows-01.json`,
    `city-to-ceremony-01.json`, `classic-luxury-01.json` — do `--write --batch B1` ghi.
  - `test/layout-geometry.test.mjs` — siết ratchet.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - 12 adoption trên 4 recipe; diff `213 insertions / 104 deletions`, không phải rewrite cả file.
  - Ratchet siết tới số **đo được**: `catalog >= 76`, `authored >= 68`, `maxShare <= 18`,
    `over12Count <= 4`; bốn recipe B1 khoá ở `3`.
- Bảy gate của Pha 2C:
  1. `--check-plan` xanh — `49 pending, 21 already applied`.
  2. Bốn recipe đều đạt meaningful `0 -> 3`.
  3. Content contract `51 execution path / 1 union text key`; photo demand và copy giữ nguyên.
  4. Gallery-tail `24/24` duy nhất; composition `253` với `0` cặp dùng chung.
  5. Ratchet chỉ siết tới số đo mới, không tới mục tiêu `12/0`.
  6. Validator `32/32` (0 error, 20 warning baseline); lint `24/24`; targeted `50/50`;
     `typecheck:scripts` exit 0; `npm run test:unit` `376/376`.
  7. Commit `161b281` ghi vào bảng Pha 2C và bảng §6.
- Kiểm thêm ngoài gate: B1 là batch đáp đất **cả hai** host `stacked_horizon_trio`, primitive có
  guard P1.7R ngặt nhất. Đo trực tiếp trên cây đã ghi: `afterparty-pulse-01/s03_dinner` và
  `cinematic-vows-01/s02_anticipation` đều `landscape/landscape/landscape`, mỗi dải
  `1180x300` (aspect `3.93`, dưới trần `4:1`), coverage `51.2%` (trên sàn `50%`), và giữ thế so le —
  `band2` lệch phải (`540` / `560`) so với `band1/band3` (`180` / `160`). Hai recipe đặt toạ độ
  khác nhau nên không tạo composition chung.
- Metric trước/sau: `catalog 64 -> 76`, `authored 56 -> 68`, `authored.shared 30 -> 30`,
  `maxShare 22 -> 18`, `over12 6 -> 4`.
- Commit: `161b281`.
- Quyết định hoặc sai lệch so với plan: Không có. Map, library và planner không đổi ở bước này.
- Ghi chú đọc số: `city-to-ceremony-01/s84_photo_duo` báo coverage `109%` vì `inset_card_hero` có
  slot `bg` full-bleed `1920x1080` cộng thêm slot `inset` chồng lên; tổng diện tích slot vượt 100%
  là đúng thiết kế của primitive đó, không phải tràn canvas. Validator vẫn `0 error`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2C batch B2` — `classic-multisong-album-01`, `family-roots-01`,
  `four-seasons-love-01`, `garden-botanical-01`. Hai lưu ý cho phiên đó: `B2` là batch đầu tiên
  chạm `classic-multisong-album-01` và `four-seasons-love-01`, cả hai đều nằm trong
  `test/fixtures/pre-adoption-recipes.json`, nên nếu phải sửa map cho hai recipe đó thì phải kiểm
  lại bản đóng băng còn `pending`; và `four-seasons-love-01/s03_autumn` là một trong sáu adoption
  chạm story beat thật chứ không phải đuôi gallery.

### 2026-07-31 — P2B pilot

- Session: Claude, theo yêu cầu "làm bước tiếp theo".
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Ghi batch `pilot`, chạy lại đủ gate, siết ratchet tới số đo thực tế, commit độc lập.
  - Không đụng `layouts/library.json`, không đụng recipe ngoài ba recipe pilot.
- File đã thay đổi:
  - `story-templates/cinematic-film-01.json`, `editorial-bold-01.json`,
    `jmii-silk-botanical-01.json` — do `--write --batch pilot` ghi.
  - `test/fixtures/pre-adoption-recipes.json` — mới.
  - `test/adopt-new-primitives.test.mjs`, `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - 9 adoption trên 3 recipe; diff `156 insertions / 78 deletions`, không phải rewrite cả file.
  - Ratchet geometry siết tới số **đo được**: `catalog >= 64`, `authored >= 56`, `maxShare <= 22`,
    `over12Count <= 6`; meaningful `cinematic-film-01 = 3`, `editorial-bold-01 = 3`,
    `jmii-silk-botanical-01 = 6`, `white-weddings-full-01` giữ `1`.
  - Bộ test planner chuyển từ "chốt trạng thái nguồn" sang "suy từ `adoptionStatus()`", cộng một
    bản đóng băng pre-adoption cho các fixture cần source `pending`. Chi tiết ở §Pha 2B.
- Lệnh đã chạy:
  - `node scripts/adoptNewPrimitives.mjs --check-plan` (trước và sau khi ghi).
  - `node scripts/adoptNewPrimitives.mjs --write --batch pilot`.
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`; `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=60000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `npm run typecheck:scripts`; `npm run test:unit`.
  - Quét 7 giai đoạn: ghi lần lượt `pilot`→`B5` rồi chạy adoption test ở từng bước,
    sau đó `git checkout -- story-templates` và ghi lại đúng `pilot`.
- Kết quả:
  - `--check-plan` trước ghi `70 pending, 0 already applied`; sau ghi `61 pending, 9 already applied`.
  - Validator `32/32` (0 error, 20 warning baseline); lint `24/24`; targeted `50/50`;
    `typecheck:scripts` exit 0; `npm run test:unit` **376/376** (375 trước, +1 test đóng băng).
  - Adoption test `22/22` ở **cả bảy** giai đoạn rollout.
  - Ba yêu cầu riêng của pilot đều đạt: cinematic có `offset_portrait_hero` và giữ nền `#D8CFC0`;
    jmii không resize slot tròn nên `circleMedallion` r=260 vẫn đúng nửa cạnh 520; editorial không
    có adoption nào ở `s03_chapter`.
- Metric trước/sau: `catalog 56 -> 64`, `authored 48 -> 56`, `authored.shared 30 -> 30`,
  `maxShare 23 -> 22`, `over12 7 -> 6`.
- Commit: `8161779`.
- Quyết định hoặc sai lệch so với plan:
  - Siết `jmii-silk-botanical-01` lên `6` chứ không phải `3`: quy ước §2.8 nói chỉ siết tới số đã
    đo, và `6` là số đo thật.
  - Sửa bộ test planner nằm ngoài mô tả gốc của P2B nhưng bắt buộc: gate số 6 của Pha 2C đòi
    targeted tests xanh, `test:unit` glob cả file này, và 3 trong 14 lỗi chỉ nổ ở `B2`/`B4`/`B5` —
    để lại thì mỗi batch sau đều dừng ở cùng chỗ.
  - Không chạy so sánh Premium trước/sau: đó là gate của Pha 1 trên một library không đổi; Pha 2 cố
    ý đổi recipe nên output Premium thay đổi là đúng thiết kế.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2C batch B1` — `--write --batch B1`, rồi đủ 7 gate của Pha 2C và siết ratchet
  tới số đo mới. Lưu ý: `B2` là batch đầu tiên chạm `classic-multisong-album-01`, recipe có trong
  bản đóng băng pre-adoption — nếu sửa map cho recipe đó thì phải kiểm lại fixture còn `pending`.

### 2026-07-31 — P2A.R2 (nghiệm thu lại Pha 2A)

- Session: Claude, theo yêu cầu người dùng đánh giá lại Pha 2 rồi sửa theo đề xuất.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Chạy lại mọi gate của Pha 2A trên cây **sau adoption** thay vì cây nguồn.
  - Sửa những gì cản rollout; không đụng `layouts/library.json` và không ghi `story-templates/`.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `scripts/newPrimitiveAdoptionMap.json`.
  - `test/adopt-new-primitives.test.mjs`.
  - `layouts/library.json` — sửa 6px lề title-safe của `diagonal_staircase_trio.heading` (lỗi Pha 1).
  - `LAYOUT-PRIMITIVES-PLAN.md` (§7.3).
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - `applyRecipePlan()` thành verify-or-apply; thêm `adoptionStatus()`.
  - Content audit thêm hợp đồng dressing: look field bị bỏ ngoài chính sách và override
    `background` do recipe vẽ bị bỏ đều là lỗi.
  - Thêm `orientationAudit()`: `orient` tường minh là lỗi cứng, `any` đổi lớp hình dạng phải khai
    `accepts: ["orientation"]`.
  - Thêm `compositionUniquenessAudit()` giữ catalogue ở mức 0 cặp recipe dùng chung composition.
  - Thêm `simulatedTargetAudit()`: đo `maxShare`/`over12`/meaningful **và** lint authoring-rules
    trên cây mô phỏng; ngưỡng chuyển vào `map.targets`.
  - Gộp gate của `--check-plan` và `--write` vào một hàm `auditWholeMap()`.
  - Cohort sáu recipe chuyển vào `map.constrainedCohort`.
  - Map: cinematic `s83` mang lại nền `#D8CFC0`; `jmii/s11` thu `major` còn 940px; `four-seasons/s03`
    chuyển sang `circle_trio_stagger`; ba entry circle nhận override riêng; 7 adoption khai
    `accepts: ["orientation"]`.
- Lệnh đã chạy:
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - `node --test --test-timeout=60000 test/adopt-new-primitives.test.mjs`.
  - `node --test --test-timeout=60000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`; `node scripts/lintStoryTemplates.mjs`.
  - `npm run typecheck:scripts`.
  - `npm run test:unit`.
  - `node scripts/adoptNewPrimitives.mjs --write --batch pilot` → chạy lại `--check-plan` và bộ test
    → `git checkout -- story-templates`.
- Kết quả:
  - Adoption test `21/21`; targeted `28/28`; validator `32/32` (0 error, 20 warning baseline);
    lint `24/24`; `typecheck:scripts` exit 0.
  - `npm run test:unit`: 374/375 ở lần chạy đầu — lỗi duy nhất là bug lề title-safe của Pha 1 nói
    trên; sau khi sửa 6px là **375/375**.
  - `--check-plan` trên cây nguồn: `70 pending, 0 already applied`; sau khi ghi pilot:
    `61 pending, 9 already applied` — gate sống sót qua batch, đúng điều P2B cần.
  - Với pilot đã ghi, `test/template-recipes.test.mjs` xanh **28/28**, gồm
    `cinematic gallery keeps portrait-safe contain crops on a light matte` — chính test mà bản map
    trước sẽ làm đỏ.
  - `story-templates/` đã khôi phục sạch sau lần ghi thử.
- Metric trước/sau:
  - Cây nguồn không đổi: reachable vẫn `23/7`.
  - Mô phỏng toàn map: `maxShare=12`, `over12=0`, 253 composition / 0 dùng chung, meaningful ≥3
    (ww-full=1). Host: circle `11`, overlap `8`, portrait `22`, golden `8`, diagonal `11`, inset `7`,
    horizon `2` — diagonal giảm 12→11 vì `four-seasons/s03` chuyển sang circle.
- Commit: `5871122` (sửa lề Pha 1) và `4ac137c` (planner + map + test + docs).
- Quyết định hoặc sai lệch so với plan:
  - Không khai `accepts` cho 26 lần bỏ `frame` trên primitive sở hữu frame: đó là chính sách P1.7R
    đặt tên trong code, không phải ngoại lệ từng dòng.
  - 11 slot `orient: "any"` đổi hình dạng được ký nhận thay vì thiết kế lại: 7 primitive đã được
    nghiệm thu bằng ảnh thật ở P1.7R, và request `any` vốn không hứa hướng ảnh nào.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2B pilot` — `--write --batch pilot`, rồi `--check-plan`, targeted tests, nâng
  ratchet đúng ba recipe và chỉ siết `maxShare/over12` tới số đo thực tế.

### 2026-07-31 06:20 — P2A.8

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Khoá đúng cohort sáu recipe chỉ có ba ứng viên theo plan.
  - Bắt buộc mỗi recipe áp đủ ba scene `s83/s84/s85`.
  - Mô phỏng cả sáu đồng thời và tái sử dụng gallery-tail audit để từ chối chuỗi trùng.
  - Nối gate vào `--check-plan`; không sửa map, library hoặc recipe.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Đủ sáu recipe; mỗi recipe có đúng ba adoption tại `s83/s84/s85`.
  - Cohort trải trên `pilot`, `B2`, `B3`, `B5`, nên gate phải chạy toàn map thay vì từng batch.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - Thêm `constrainedCohortAudit()` khoá đúng sáu recipe trong plan.
  - Mỗi recipe phải có chính xác adoption `s83/s84/s85`.
  - Cả sáu recipe được lấy từ trạng thái full-map đã mô phỏng rồi kiểm đồng thời bằng
    `galleryTailAudit()`.
  - `--check-plan` fail khi cohort thiếu adoption/recipe hoặc có signature trùng.
- Lệnh/kiểm tra đã chạy:
  - Probe cohort/batch/adoption hiện tại bằng Node.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - `npm run typecheck:scripts`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - SHA-256 24 recipe trước/sau `--check-plan`.
  - `git diff --check`.
- Kết quả:
  - `Constrained cohort contract: 6/6 unique gallery-tail signature(s); each adopts s83 > s84 > s85.`
  - Fixture bắt được một recipe thiếu tail adoption và xung đột chỉ lộ ra khi hai recipe được mô
    phỏng đồng thời.
  - Adoption test `14/14` pass; targeted adoption/geometry/library/template `42/42` pass.
  - Lint `24/24` clean; `typecheck:scripts` xanh.
  - SHA-256 `24/24` recipe không đổi (`HASH_CHANGED=0`).
  - `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau: Source không đổi; cohort mô phỏng giữ `6/6` gallery-tail duy nhất.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Tái sử dụng `galleryTailAudit()` của P2A.6 và chỉ bổ sung contract về membership/adoption để
    tránh hai định nghĩa signature khác nhau.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2B pilot` — áp batch `pilot` cho `cinematic-film-01`,
  `jmii-silk-botanical-01`, `editorial-bold-01`, sau đó chạy `--check-plan`, nâng ratchet đúng ba
  recipe và chỉ siết maxShare/over12 tới số đo thực tế.

### 2026-07-31 06:17 — P2A.7

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đếm số recipe host duy nhất cho từng primitive active trên toàn adoption map.
  - Từ chối primitive active có dưới hai recipe host, target ngoài danh sách active và mọi entry
    dùng primitive Pha 1b.
  - Nối gate vào `--check-plan`; không sửa map, library hoặc recipe.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Phân bố host đo được: overlap `8`, inset `7`, circle `11`, diagonal `12`, golden `8`,
    horizon `2`, portrait `22`.
  - `offset_quad_pinwheel` và `filmstrip_band` có `0` adoption; không có target lạ.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - Thêm `primitiveHostAudit()` đếm recipe host duy nhất cho từng primitive active.
  - Từ chối primitive active dưới hai host, target không active, giao nhau active/Pha 1b và mọi
    adoption dùng `offset_quad_pinwheel` hoặc `filmstrip_band`.
  - `--check-plan` fail khi contract lỗi và in distribution host đã kiểm.
- Lệnh/kiểm tra đã chạy:
  - Probe distribution toàn map bằng Node.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - `npm run typecheck:scripts`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - SHA-256 24 recipe trước/sau `--check-plan`.
  - `git diff --check`.
- Kết quả:
  - Host theo recipe: overlap `8`, inset `7`, circle `11`, diagonal `12`, golden `8`,
    horizon `2`, portrait `22`; cả 7 primitive đạt sàn.
  - `0` adoption Pha 1b và `0` target lạ.
  - Fixture bắt được horizon tụt `2 -> 1` host và adoption lén dùng `offset_quad_pinwheel`.
  - Adoption test `13/13` pass; targeted adoption/geometry/library/template `41/41` pass.
  - Lint `24/24` clean; `typecheck:scripts` xanh.
  - SHA-256 `24/24` recipe không đổi (`HASH_CHANGED=0`).
  - `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau: Source không đổi; host distribution giữ `8/7/11/12/8/2/22`.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Đếm recipe host duy nhất thay vì số adoption để bám đúng yêu cầu “được ≥2 recipe dùng”.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.8` — mô phỏng đồng thời sáu recipe chỉ có ba ứng viên và khóa không xung
  đột gallery-tail.

### 2026-07-31 05:46 — P2A.6

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Áp toàn bộ adoption map in-memory rồi resolve đuôi `s83 > s84 > s85` của đủ 24 recipe.
  - Từ chối recipe thiếu/sai thứ tự ba scene hoặc trùng chuỗi `visualSignature`.
  - Nối gate vào `--check-plan`; không ghi `story-templates/*.json`.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Probe read-only trên trạng thái mô phỏng cho `RECIPES=24`, `DISTINCT=24`, `CLASHES=[]`.
  - Worktree giữ thay đổi Pha 1/P2A trước đó; session này không sửa map, library hoặc recipe.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - Thêm `galleryTailAudit()` resolve đúng trạng thái mô phỏng của đủ 24 recipe.
  - Mỗi recipe phải có đúng ba scene theo thứ tự `s83 > s84 > s85`.
  - Chuỗi `visualSignature` của ba scene phải duy nhất trên toàn catalogue.
  - `--check-plan` fail khi contract lỗi và in số chuỗi duy nhất đã kiểm.
- Lệnh/kiểm tra đã chạy:
  - Probe read-only toàn map bằng `applyRecipePlan()` + `resolveTemplate()` + `visualSignature()`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - `npm run typecheck:scripts`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - SHA-256 24 recipe trước/sau `--check-plan`.
  - `git diff --check`.
- Kết quả:
  - `Gallery-tail contract: 24/24 unique s83 > s84 > s85 signature(s).`
  - Fixture bắt được hai recipe dùng chung một chuỗi và thứ tự sai `s84 > s83 > s85`.
  - Adoption test `12/12` pass; targeted adoption/geometry/library/template `40/40` pass.
  - Lint `24/24` clean; `typecheck:scripts` xanh.
  - SHA-256 `24/24` recipe không đổi (`HASH_CHANGED=0`).
  - `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau: Source không đổi; mô phỏng giữ `24/24` gallery-tail signature duy nhất.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Dùng cùng `visualSignature` với regression hiện hữu để CLI và test không định nghĩa hai chuẩn
    gallery-tail khác nhau.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.7` — kiểm mỗi primitive active có ít nhất hai host và không có Pha 1b.

### 2026-07-31 05:41 — P2A.5

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - So photo demand trước/sau trên scene chính, `muteFallback` và mọi repeatable variant.
  - Bảo toàn union text key và từ chối đường chạy có copy không còn text slot đích.
  - Nối gate vào `--check-plan`; không ghi bất kỳ recipe nào.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Worktree giữ các thay đổi Pha 1/P2A.1–P2A.R1 chưa commit; session này chỉ nối tiếp đúng ba
    file trên và không ghi `story-templates/*.json`.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi:
  - Thêm `adoptionContentAudit()` duyệt độc lập scene chính, `muteFallback` và từng
    `repeatable.variants[n]`.
  - Mỗi đường chạy resolve geometry thật rồi so photo demand trước/sau.
  - Union text key authored trước/sau phải bằng nhau; mọi key sau adoption phải có text slot
    tương ứng trong layout đã resolve.
  - `--check-plan` fail khi content contract lỗi và in số đường chạy/text key đã kiểm.
- Lệnh/kiểm tra đã chạy:
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - `npm run typecheck:scripts`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - SHA-256 24 recipe trước/sau `--check-plan`.
  - `git diff --check` và `git status --short -- story-templates`.
- Kết quả:
  - Map thật kiểm `72` execution path của `70` adoption trên `23` recipe; photo demand không đổi.
  - Union text contract có `1` key (`heading`) và không key nào thiếu slot sau adoption.
  - Regression fixture bắt được đổi demand `1 -> 2`, copy thiếu slot, union text key thay đổi và
    đường `muteFallback` drift độc lập.
  - Adoption test `11/11` pass; targeted adoption/geometry/library/template `39/39` pass.
  - `typecheck:scripts` xanh; SHA-256 `24/24` recipe không đổi (`HASH_CHANGED=0`).
  - `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau: Không đổi source geometry; bước này chỉ thêm gate read-only cho content.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Gate kiểm cả equality của union key lẫn khả năng layout sau adoption render từng key, vì chỉ
    so union authored sẽ không phát hiện builder âm thầm bỏ copy.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.6` — mô phỏng toàn map và kiểm chuỗi gallery-tail toàn cục vẫn duy nhất.

### 2026-07-30 22:38 — P2A.R1 / gộp P1.7R

- Session: Codex; nguồn nghiệm thu lại: Claude trong `LAYOUT-PRIMITIVES-P1-REAUDIT.md`.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Ghi nhận P1.7 cũ lỗi thời và gộp bằng chứng P1.7R vào tracker.
  - Rebase adoption map khỏi hình học cũ của horizon/portrait/diagonal.
  - Không giữ global look frame trên primitive có frame nội tại.
  - Thu hẹp `stacked_horizon_trio` còn host có toàn bộ request landscape.
  - Thêm guard P1.7R vào `--check-plan` và cập nhật phần Pha 2 trong plan.
- File dự kiến thay đổi:
  - `scripts/newPrimitiveAdoptionMap.json`.
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PLAN.md`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - P1.7R đã sửa library và thêm `scripts/renderPrimitiveProbe.mjs`; session này giữ nguyên các
    thay đổi đó, chỉ cập nhật phần Pha 2 phụ thuộc vào chúng.
  - 46/69 adoption hiện nhắm bốn primitive đã được P1.7R sửa; map cũ chưa an toàn để rollout.
- File đã thay đổi:
  - `scripts/newPrimitiveAdoptionMap.json`.
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PLAN.md`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Thay đổi Pha 2:
  - 22 `offset_portrait_hero` giữ kích thước P1.7R `1240×900`; chỉ nudge vị trí.
  - 12 `diagonal_staircase_trio` giữ slot `620×500`, coverage `≥44%`.
  - `stacked_horizon_trio` thu từ 8 xuống đúng 2 host all-landscape:
    `afterparty-pulse-01/s03_dinner` và `cinematic-vows-01/s02_anticipation`; aspect `≤4:1`,
    coverage `≥50%`, giữ thế so le.
  - Pilot `cinematic-film-01/s08c_breather` chuyển từ horizon sang `circle_trio_stagger` vì
    ba request đều portrait.
  - `circle_trio_stagger`, `overlap_stack_duo`, `inset_card_hero` không giữ global look frame,
    nên frame nội tại không bị precedence đè mất.
  - Thêm adoption thứ 70 cho `four-seasons-love-01/s03_autumn` cùng repeat variants để hạ group
    `paper_collage` dự kiến từ share 13 xuống 12.
  - Plan ghi guard P1.7R, thu hẹp host horizon và cập nhật risk R2.
- Lệnh/kiểm tra đã chạy:
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `npm run typecheck:scripts`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - Mô phỏng toàn map bằng `applyRecipePlan()` + `geometryStats()`.
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - SHA-256 24 recipe trước/sau check và `git diff --check`.
- Kết quả:
  - `--check-plan`: `Checked 70 adoption(s) across 23 recipe(s); no files written.`
  - Guard P1.7R kiểm intrinsic frame, horizon orientation/aspect/stagger/coverage và
    portrait/diagonal coverage; fixture stale 1020px bị từ chối.
  - Mô phỏng sau toàn map: `catalog=121`, `authored=113`, `reachable.maxShare=12`,
    `reachable.over12Count=0`; 23 recipe tự do đều meaningful `≥3`,
    `white-weddings-full-01=1`.
  - Host: circle `11`, overlap `8`, portrait `22`, golden `8`, diagonal `12`, inset `7`,
    horizon `2`; không có primitive Pha 1b.
  - Validator `32/32`, 0 error, 20 baseline warning; lint `24/24` clean.
  - Targeted adoption/geometry/library/template `36/36` pass; `typecheck:scripts` xanh.
  - SHA-256 24 recipe không đổi (`HASH_CHANGED=0`); map SHA-256
    `463D80B8BA8ECC373A6D4621A158D09076D9BD6B53962B340A9FA1C59228C1BD`.
  - `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau:
  - Source hiện tại chưa đổi: reachable vẫn baseline 23/7.
  - Mô phỏng full adoption sau rebase: maxShare `12`, over12 `0`, meaningful đạt mục tiêu.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Map tăng 69 → 70 adoption để xử lý group `paper_collage` còn share 13; vẫn đúng luật mỗi
    recipe có ít nhất ba scene meaningful.
  - Horizon cố ý chỉ có số host tối thiểu 2 để ưu tiên crop an toàn trên ảnh thật.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.5` — kiểm photo demand và union text key trước/sau trên main,
  `muteFallback` và repeatable variants.

### 2026-07-30 22:29 — P2A.4

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Dùng `geometryStats().reachable.groups` trên đủ 24 source recipe trước khi áp map.
  - In bảy group có `share > 12` theo geometry key → recipe → mọi occurrence.
  - Mỗi occurrence ghi location, source, look và layout; giữ main, `muteFallback` và repeat variant.
  - Chưa thêm gate photo/text, gallery-tail hoặc host P2A.5–P2A.8.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Baseline đo lại có đúng bảy group, share `23/15/15/14/14/13/13`.
  - Bảy group chứa tổng hợp đủ ba source kind: main, `muteFallback`, repeatable variant.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh/kiểm tra đã chạy:
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `npm run typecheck:scripts`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan` và parse report bằng regex.
  - Tính SHA-256 24 recipe trước/sau check.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `git diff --check`.
- Kết quả:
  - Check mode đo `geometryStats()` trên đủ 24 source recipe trước khi áp map.
  - Report in đúng `7` group với share `23/15/15/14/14/13/13`.
  - Mỗi group in full geometry key, recipe và từng location/source/look/layout.
  - Tổng `161` occurrence được giữ nguyên: `100` main, `21` `muteFallback`,
    `40` repeatable variant.
  - Regression test đếm số dòng occurrence bằng chính tổng `group.occurrences.length` và bắt buộc
    report có đủ ba source kind cùng index `.repeatable.variants[n]`.
  - SHA-256 24 recipe không đổi; check mode vẫn báo 23 recipe / 69 adoption và không ghi file.
  - Unit adoption `6/6` pass; targeted adoption/geometry/layout/template `34/34` pass.
  - `typecheck:scripts` xanh; `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau: Không đổi source; baseline reachable report là 7 group / 161 occurrence.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Report dùng source của đủ 24 recipe, không chỉ 23 recipe có adoption, để recipe ngoại lệ vẫn
    được tính đúng vào share baseline.
  - Chỉ group `share > 12` được in; các group khác chưa tham gia P2A.4.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.5` — so photo demand và union text key trước/sau cho main,
  `muteFallback` và mọi repeatable variant.

### 2026-07-30 22:25 — P2A.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Thêm `--check-plan` để áp toàn bộ adoption map in-memory và resolve 23 recipe.
  - Cấm kết hợp `--check-plan` với `--write`; không ghi file trong check mode.
  - Thêm regression test so nội dung toàn bộ `story-templates/*.json` trước/sau command.
  - Chưa thêm occurrence report hoặc gate P2A.4–P2A.8.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - P2A.2 đã có hàm thuần `applyRecipePlan()` và guarded batch writer.
  - Không file recipe nào đang thay đổi; `scripts/renderPrimitiveProbe.mjs` vẫn ngoài phạm vi.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh/kiểm tra đã chạy:
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `npm run typecheck:scripts`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan`.
  - Tính SHA-256 riêng cho 24 file `story-templates/*.json` trước/sau `--check-plan`.
  - `node scripts/adoptNewPrimitives.mjs --check-plan --write`.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `git diff --check` và `git status --short -- story-templates`.
- Kết quả:
  - `--check-plan` áp toàn bộ map bằng `applyRecipePlan()` trong bộ nhớ, resolve từng recipe và
    báo `Checked 69 adoption(s) across 23 recipe(s); no files written.`
  - Cả 24 SHA-256 recipe không đổi: `HASH_FILES=24`, `HASH_CHANGED=0`.
  - Tổ hợp `--check-plan --write` bị từ chối với exit 1; check mode không nhận `--batch`.
  - Regression test mới đọc toàn bộ recipe trước/sau subprocess và xác nhận byte-for-byte không đổi.
  - Unit adoption `5/5` pass; targeted adoption/geometry/layout/template `33/33` pass.
  - `typecheck:scripts` xanh; `git diff --check` sạch ngoài warning line ending có sẵn.
- Metric trước/sau: Không có source geometry nào đổi; `--check-plan` chỉ dựng 23 recipe / 69 adoption
  trong bộ nhớ.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Check mode luôn kiểm toàn bộ map, không nhận batch, để bằng chứng read-only không vô tình chỉ
    bao phủ một phần rollout.
  - Resolve error cơ bản chặn cả check và write mode; các gate chuyên biệt vẫn thuộc P2A.4–P2A.8.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.4` — thêm report đầy đủ mọi occurrence của bảy reachable geometry key
  đang bị dùng quá rộng, gồm main, `muteFallback` và repeatable variant.

### 2026-07-30 22:17 — P2A.2

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Tạo `scripts/adoptNewPrimitives.mjs` đọc map P2A.1 và áp một batch có kiểm tra source expectation.
  - Tạo look riêng cho từng adoption, remap ID photo slot theo thứ tự và dọn look nguồn chỉ khi
    không còn đường chạy nào tham chiếu.
  - Chỉ cho phép ghi khi truyền rõ `--write --batch <pilot|B1|...|B5>`.
  - Chưa cài `--check-plan`, report key rộng hoặc các gate toàn cục P2A.3–P2A.8.
- File dự kiến thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `tsconfig.scripts.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Map P2A.1 parse được và có 23 recipe / 69 adoption.
  - `scripts/renderPrimitiveProbe.mjs` là file untracked ngoài phạm vi; session này giữ nguyên.
- File đã thay đổi:
  - `scripts/adoptNewPrimitives.mjs`.
  - `test/adopt-new-primitives.test.mjs`.
  - `tsconfig.scripts.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh/kiểm tra đã chạy:
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs`.
  - `npm run typecheck:scripts`.
  - Áp cả 23 recipe / 69 adoption in-memory rồi chạy `resolveTemplate()` cho từng recipe.
  - `node scripts/adoptNewPrimitives.mjs --batch pilot` để xác nhận thiếu `--write` bị từ chối.
  - `node --test --test-timeout=30000 test/adopt-new-primitives.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `git diff --check` và `git status --short -- story-templates`.
- Kết quả:
  - Script đọc nguồn chuẩn P2A.1, áp đúng một batch và kiểm scene/look/layout nguồn trước khi ghi.
  - Mỗi adoption tạo look riêng, chỉ giữ `frame`/`photoTreatment`/`motion` được map cho phép,
    thay hoàn toàn layout override cũ và remap `photoSlots[].slot` theo ID của primitive đích.
  - Look nguồn chỉ bị xoá khi không còn main, `muteFallback` hoặc repeatable variant tham chiếu.
  - Toàn bộ batch được chuẩn bị trong bộ nhớ trước; chỉ ghi sau khi tất cả recipe đã hợp lệ và
    command có đủ `--write --batch`.
  - Unit test mới `4/4` pass; targeted geometry/layout/template + adoption `32/32` pass.
  - `typecheck:scripts` xanh.
  - Mô phỏng 23 recipe / 69 adoption có `0` resolve error.
  - Invocation không có `--write` exit 1 như dự kiến; không file `story-templates/*.json` nào đổi.
  - `git diff --check` sạch; chỉ có warning line ending trên file tracked hiện hữu.
- Metric trước/sau: Chưa ghi adoption vào recipe; metric geometry runtime không đổi.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Thêm guard `--write --batch` để P2A.2 không thể vô tình rollout trước khi `--check-plan`
    của P2A.3 tồn tại và xanh.
  - Script export `applyRecipePlan()` thuần để P2A.3 tái sử dụng cùng logic khi mô phỏng in-memory.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.3` — thêm `--check-plan` áp toàn map in-memory và chứng minh hash/source
  không đổi; chưa triển khai report/gate P2A.4–P2A.8 trong bước đó.

### 2026-07-30 22:11 — P2A.1

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Tạo nguồn chuẩn machine-readable cho 23 recipe được phép migrate.
  - Mỗi recipe chỉ rõ scene, look/layout nguồn, primitive đích, look đích và override hình học.
  - Giữ `white-weddings-full-01` ngoài map; từ chối hai primitive Pha 1b.
  - Chưa viết hoặc chạy chế độ áp map; phần đó thuộc `P2A.2`–`P2A.3`.
- File dự kiến thay đổi:
  - `scripts/newPrimitiveAdoptionMap.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Worktree có bốn file tracked đang thay đổi từ Pha 1; P2A.1 không ghi đè nội dung source/test đó.
  - Candidate snapshot và ba pilot đã được đối chiếu với source recipe hiện tại.
- File đã thay đổi:
  - `scripts/newPrimitiveAdoptionMap.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh/kiểm tra đã chạy:
  - Parse JSON và duyệt toàn bộ map bằng Node.
  - Đối chiếu từng `sceneId`, source look và source layout với 23 recipe hiện tại.
  - Đối chiếu photo demand của scene/source/primitive đích.
  - Dựng look đích in-memory từ `preserveLookFields` + `layoutOverrides`, rồi chạy `validateLook()`.
  - Kiểm đúng 23 recipe / 69 adoption, không có `white-weddings-full-01`, không có primitive Pha 1b,
    không trùng scene/look đích trong cùng recipe và mỗi primitive có ít nhất hai host.
  - `git diff --check`.
- Kết quả:
  - Map parse thành công; đúng 23 recipe và mỗi recipe có đúng ba adoption (`69` tổng cộng).
  - Cả 69 source scene/look/layout đều khớp source hiện tại; photo demand không đổi.
  - Cả 69 look đích qua validator, `0` error.
  - Host theo primitive:
    `overlap_stack_duo=8`, `inset_card_hero=7`, `circle_trio_stagger=8`,
    `diagonal_staircase_trio=8`, `golden_column_pair=8`, `stacked_horizon_trio=8`,
    `offset_portrait_hero=22`.
  - Recipe ngoại lệ không có trong map; `offset_quad_pinwheel` và `filmstrip_band` chỉ nằm trong
    danh sách cấm, không có adoption.
  - SHA-256 map:
    `5EA17DD192D42C049260B59D255B7FAE21255780EE5C22AA0C06BA73666A1E99`.
  - `git diff --check` sạch; chỉ có cảnh báo line ending có sẵn trên bốn file tracked.
  - Ở lần `git status` cuối, `scripts/renderPrimitiveProbe.mjs` xuất hiện untracked ngoài phạm vi
    P2A.1; session này không đọc, sửa hoặc xoá file đó.
- Metric trước/sau: Chưa áp map vào recipe; geometry metric runtime chưa đổi. Map tĩnh khóa 23/69
  và phân bố host `8/7/8/8/8/8/22`.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Mỗi adoption tạo look đích riêng thay vì sửa look nguồn dùng chung; map ghi rõ các trường look
    được giữ lại để script P2A.2 không vô tình mang `layoutOverrides` cũ sang primitive có slot khác.
  - Với primitive tròn, không giữ global `frame` của look nguồn để frame recipe không đè
    `circleMedallion`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.2` — tạo `scripts/adoptNewPrimitives.mjs` đọc map và áp dụng có kiểm tra
  source expectation; chưa cài `--check-plan` trong bước đó.

### 2026-07-30 21:59 — P1.9

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`; trạng thái kết thúc: `DONE`.
- Phạm vi:
  - Đối chiếu `temp/premium-before.txt` và `temp/premium-after.txt` theo dữ liệu ổn định:
    scene ID/thời lượng/renderer, số ảnh, duration và danh sách layout/effect.
  - Kiểm phân bố ảnh/scene trên timeline after và xác nhận không có card 4/5 ảnh.
  - Không sửa source; chỉ cập nhật bằng chứng và trạng thái Pha 1.
- File dự kiến thay đổi:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Hai snapshot before/after và timeline after đều tồn tại.
  - Worktree còn đúng bốn file tracked đã thay đổi từ Pha 1; P1.9 không ghi đè source/test.
- File đã thay đổi:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh/kiểm tra đã chạy:
  - Parse hai log bằng regex và so sánh từng chữ ký
    `scene index | scene ID | duration | renderer`.
  - Chuẩn hoá toàn log bằng cách bỏ timestamp và các dòng chỉ khác do thu stderr
    (SQLite ExperimentalWarning và thông báo placeholder), sau đó `Compare-Object`.
  - Chuẩn hoá và so sánh riêng tập preflight warning.
  - Parse `projects/layout-primitives-premium-baseline/timeline/timeline.json` để đếm ảnh từng scene,
    ảnh unique, ảnh chưa dùng, card 4/5 và phân bố effect.
- Kết quả:
  - Log chuẩn hoá before/after cùng `176` dòng, diff `0`.
  - Hai snapshot cùng `38` render row; toàn bộ scene ID, duration và renderer khớp theo thứ tự,
    diff `0`; canonical render SHA-256
    `542E69238D4F267F6F31C5CE606D6C08D18A9A00B80BB3CC0F87DD4325F099E0`.
  - Ba preflight warning ở hai phía giống hệt sau khi bỏ timestamp; warning diff `0`.
  - Shape phim giữ nguyên: `38` scene, estimated final duration `188,83` giây, `82` photo refs
    và `82` ảnh unique; `unusedPhotos=0`.
  - Phân bố ảnh/scene khớp baseline: một scene 0 ảnh, 28 scene 1 ảnh, chín scene 6 ảnh.
    Không có scene 4 hoặc 5 ảnh.
  - Phân bố effect authored khớp đủ 11 nhóm baseline:
    `layer_scene=5`, `film_roll_up=3`, `slow_zoom_in=4`, `memory_wall=3`,
    `kenburns_tl=4`, `pan_right=4`, `collage_grid=3`, `slow_zoom_out=3`,
    `dark_feather=3`, `portrait_blur_background=3`, `circle_focus=3`.
  - Khác biệt hash/file-size giữa hai log chỉ đến từ timestamp và cách snapshot after thu stderr;
    không phải khác biệt hành vi.
  - Không cần sửa source trong P1.9.
- Metric trước/sau: Không đổi scene count, duration, photo demand, effect distribution hoặc warning set;
  card 4/5 vẫn bằng 0.
- Commit: Chưa commit.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P2A.1` — tạo adoption map machine-readable.

### 2026-07-30 21:49 — P1.8

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`; trạng thái kết thúc: `DONE`.
- Phạm vi:
  - Chạy lại Premium dry-run trên project cố định `projects/layout-primitives-premium-baseline`.
  - Giữ `--choice A --music-choice full`, provider STUB và không dùng `--resume`, giống snapshot before.
  - Lưu stdout/stderr và kiểm kết thúc thành công của `temp/premium-after.txt`; chưa làm so sánh
    before/after chi tiết vì phần đó thuộc P1.9.
- File/artefact dự kiến thay đổi:
  - `temp/premium-after.txt` (ignored).
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Project baseline và `temp/premium-before.txt` đều tồn tại; `temp/premium-after.txt` chưa tồn tại.
  - Worktree còn đúng bốn file tracked đã thay đổi từ Pha 1; P1.8 không sửa các file source/test đó.
- File/artefact đã thay đổi:
  - `temp/premium-after.txt` (ignored).
  - Các artefact analysis/timeline trong project baseline được dry-run tái sinh; không có tracked file mới.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Xoá `VISION_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY` khỏi process.
  - `npm run premium -- --project projects/layout-primitives-premium-baseline --dry-run --choice A --music-choice full`.
  - `Get-FileHash -Algorithm SHA256 temp/premium-after.txt` và kiểm các marker kết thúc.
- Kết quả:
  - Exit 0; photo content, brief, story options/plan và director notes đều xác nhận provider STUB.
  - Giữ `82/82` ảnh; timeline validation đạt ngay attempt 1/3.
  - Dry-run load và compile đủ `38/38` slide; preflight có `82` image refs unique, một music track,
    thời lượng ước tính `188,83` giây; xfade chia ba batch và pipeline kết thúc `SUCCESS (premium)`.
  - Có ba advisory crop-risk ở `s01`, `s24`, `s31` và một Node SQLite ExperimentalWarning;
    không có error hoặc validation fallback.
  - `temp/premium-after.txt`: `31.584` byte, `208` dòng, SHA-256
    `0A2DCB818C834D0D2836B023408626BC6D3B9514D8EE4DEAC20685D1061E1AA8`.
  - Chưa diễn giải chênh lệch before/after trong bước này; phần đó thuộc P1.9.
- Metric trước/sau: Chưa kết luận; P1.8 chỉ tạo snapshot after.
- Commit: Chưa commit; artefact after bị `.gitignore` loại khỏi Git.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.9` — đối chiếu snapshot Premium trước/sau, scene/photo demand và card 4/5.

### 2026-07-30 21:25 — P1.7

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`; trạng thái kết thúc: `DONE`.
- Phạm vi:
  - Xác nhận `temp/scene-cache` không tồn tại trước render; nếu có thì chỉ xoá đúng thư mục đó.
  - Render thật `temp/probe-primitives.json`.
  - Kiểm metadata/output và review bằng mắt cả bảy primitive.
- File/artefact dự kiến thay đổi:
  - `temp/scene-cache/` và `temp/probe-primitives.mp4` (đều ignored).
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Trạng thái hiện tại:
  - Đã resolve target cache tuyệt đối bên trong worktree; cache hiện không tồn tại nên không có
    dữ liệu nào cần xoá.
  - Probe JSON tồn tại; render thật đã hoàn tất từ cache sạch.
- File/artefact đã thay đổi:
  - `temp/scene-cache/`: 7 clip scene mới.
  - `temp/probe-primitives.mp4`: output nghiệm thu mới.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`: cập nhật trạng thái và bằng chứng P1.7.
- Lệnh đã chạy:
  - Resolve `temp/scene-cache` về đường dẫn tuyệt đối và `Test-Path` trước render.
  - `npm run render -- --timeline temp/probe-primitives.json`.
  - `ffprobe` kiểm codec, kích thước, fps, duration và stream; `Get-FileHash -Algorithm SHA256`.
  - Watch probe ở mức `balanced` với 7 cue giữa cảnh, sau đó probe chính xác 28 timestamp tại
    mở đầu, trạng thái ổn định và quanh cả sáu điểm xfade; toàn bộ frame liệt kê đã được xem.
- Kết quả:
  - Cache không tồn tại trước render, vì vậy không có dữ liệu cũ để xoá; renderer tạo mới đủ
    7/7 clip scene và ghép xfade thành công, không reuse scene clip.
  - Video H.264 `1920x1080`, `30 fps`, không audio, dài `36,466667` giây, kích thước
    `4.669.960` byte; SHA-256
    `44D7325EC4ADA3B7DB796040E6B3E2FE2D62C70045D851A72F57FD0511721ED9`.
  - Review trạng thái ổn định đạt cho cả 7 primitive: overlap/rotation, inset card, ba mask tròn,
    diagonal staircase, golden columns, ba dải ngang và portrait offset đều đúng silhouette,
    thứ tự lớp, khoảng trắng; không clipping hoặc tràn canvas.
  - Review 28 frame chính xác xác nhận animation vào cảnh và cả sáu xfade liên tục; frame
    `0,05s` là nền mở đầu trước khi fade-in có chủ đích, không có khung trắng bất thường giữa cảnh.
  - Cảnh báo crop-risk đều là advisory dự kiến từ các slot `fit:"cover"`; không có lỗi render.
  - Không cần sửa source trong P1.7.
- Metric trước/sau: Không thay đổi metric geometry; đây là gate render/review bằng mắt.
- Commit: Chưa commit; video và scene cache là artefact ignored.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.8` — chạy Premium dry-run sau thay đổi và lưu `temp/premium-after.txt`.

### 2026-07-30 19:59 — P1.6

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Dựng `temp/probe-primitives.json` với đúng 7 `layer_scene`.
  - Mỗi primitive active xuất hiện đúng một lần và dùng chung một bộ ảnh nguồn.
  - Kiểm JSON/timeline/preflight; chưa xoá cache hoặc render thật, phần đó thuộc P1.7.
- File dự kiến thay đổi:
  - `temp/probe-primitives.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `temp/probe-primitives.json` (artefact local trong `temp/`, bị `.gitignore` loại khỏi Git).
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Probe Node đối chiếu slide ID, photo/text geometry với `layouts/library.json` và pool ảnh chung.
  - `npm run render -- --timeline temp/probe-primitives.json --dry-run` (hai lần).
  - `Get-FileHash -Algorithm SHA256 temp/probe-primitives.json`.
  - `git diff --check -- LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Probe có đúng 7 `layer_scene`, theo đúng thứ tự primitive active; 7 ID unique.
  - Mỗi slide khớp photo count, slot ID, geometry, fit và rotation của primitive tương ứng.
  - Mọi image layer lấy từ cùng pool ba ảnh `002.jpg`, `003.jpg`, `029.jpg`;
    tổng 16 image refs và 3 ảnh unique.
  - Dry-run cuối exit 0: timeline validation/preflight xanh, 7/7 slide được compile,
    thời lượng ước tính 36,50 giây, không có music.
  - Preflight chỉ có advisory crop-risk do các slot chủ đích dùng `fit:"cover"`; không có error.
  - Lần dry-run đầu fail vì token theme trỏ tới font không có trên đĩa
    `fonts/CormorantGaramond-Regular.ttf`; probe đổi sang font hiện có và hỗ trợ tiếng Việt
    `fonts/PlayfairDisplay.ttf`, không sửa library.
  - Artefact 10.482 byte; SHA-256
    `90D07EE000E0E4BDCCE3EA1668B39EE9BAB8A8F1AE84EFE76071A07DCF8DA2E8`.
- Metric trước/sau: Không thay đổi metric geometry; đây là artefact nghiệm thu hình ảnh.
- Commit: Chưa commit; `temp/probe-primitives.json` là artefact ignored.
- Quyết định hoặc sai lệch so với plan:
  - Dùng cú pháp thực của renderer `--timeline temp/probe-primitives.json`; đối số positional
    ghi trong plan không được `src/index.ts` đọc.
  - P1.6 chỉ dry-run; chưa xoá cache hoặc render video thật để giữ đúng ranh giới P1.7.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.7` — xoá `temp/scene-cache`, render probe thật và review bằng mắt.

### 2026-07-30 19:56 — P1.5

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đo lại metric V2 trên library 32 layout và 24 recipe hiện tại.
  - Nâng ratchet `catalog.distinct` tới đúng số đo thực tế; giữ các ratchet authored/reachable.
  - Chạy lại geometry test và targeted gate liên quan.
- File dự kiến thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Probe Node gọi `geometryStats()` trên 32 layout và 24 recipe.
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `git diff --check -- test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Metric đo trước khi sửa: `catalog.distinct=56`, `catalog.shared=30`,
    `catalog.maxShare=23`, `catalog.over12Count=6`, 265 occurrence.
  - `authored.distinct=48`, `authored.shared=30`, `authored.maxShare=23`,
    `authored.over12Count=6`, 233 occurrence.
  - `reachable.distinct=49`, `reachable.shared=30`, `reachable.maxShare=23`,
    `reachable.over12Count=7`, 396 occurrence.
  - Nâng đúng một ratchet `catalog.distinct` từ `>=49` lên `>=56`.
  - Targeted geometry/layout/template 28/28 pass; 0 fail.
- Metric trước/sau: Ratchet catalog 49 → 56 theo số đo thực; không thay đổi source geometry trong bước này.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Giữ nguyên `authored.distinct >=48`, `reachable.maxShare <=23` và
    `reachable.over12Count <=7` đúng phạm vi P1.5.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.6` — dựng timeline probe 7 scene, mỗi primitive xuất hiện đúng một lần.

### 2026-07-30 19:55 — P1.4

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Chạy đúng bộ targeted geometry/layout/template được quy định trong §9.1 của plan.
  - Chỉ sửa regression trực tiếp từ P1.1–P1.3 nếu test phát hiện.
- File dự kiến thay đổi:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
  - Source/test Pha 1 chỉ khi targeted test thất bại vì thay đổi hiện tại.
- File đã thay đổi trong bước này:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
  - Không cần sửa source hoặc test.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `git diff --check -- LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - 28/28 test pass; 0 fail, 0 cancelled, 0 skipped.
  - Geometry ratchets, library invariants và template recipe contracts đều xanh.
- Metric trước/sau: Không đổi geometry/source trong P1.4; phép đo `catalog.distinct` thuộc P1.5.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan: Không có; dùng đúng ba test file trong §9.1.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.5` — đo số thực tế rồi nâng ratchet `catalog.distinct`.

### 2026-07-30 19:52 — P1.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Chạy validator G1–G8 trên đủ 32 layout.
  - Đối chiếu G4 với đúng ba offender cũ và xác nhận bảy primitive mới không thêm offender.
  - Chỉ sửa source nếu validator phát hiện lỗi trực tiếp trong bảy primitive mới.
- File dự kiến thay đổi:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
  - `layouts/library.json` chỉ khi cần sửa lỗi validator.
- File đã thay đổi trong bước này:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
  - Không cần sửa `layouts/library.json` hoặc test.
- Lệnh đã chạy:
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - Probe Node gọi `validateLayouts()` để nhóm finding theo gate, layout và bảy ID mới.
  - `git diff --check -- LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Validator 32/32 pass, 0 error, 20 warning.
  - G1–G3 và G6–G8 có 0 finding.
  - G4 còn đúng ba offender baseline đã grandfather:
    `three_photo_row.caption`, `two_photo_story.body`, `collage_cluster_text.body`.
  - G5 còn 17 warning baseline; đây là advisory warning theo gate.
  - Bảy primitive mới có 0 error và 0 warning trên mọi gate.
- Metric trước/sau: Không thay đổi source/geometry trong P1.3; chỉ nghiệm thu trạng thái 32 layout.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan: Không có; áp dụng đúng ghi chú grandfather G4.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.4` — chạy targeted tests.

### 2026-07-30 19:44 — P1.2

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Append nguyên văn 7 primitive active từ §6.2 vào cuối `layouts`.
  - Khóa tổng 32 layout, prefix 25 ID cũ và thứ tự 7 ID mới bằng test.
  - Chưa nghiệm thu đầy đủ G1–G8; phần đó thuộc P1.3.
- File dự kiến thay đổi:
  - `layouts/library.json`.
  - `test/library.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `layouts/library.json`.
  - `test/library.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/library.test.mjs` trước khi append.
  - `node --test --test-timeout=30000 test/library.test.mjs` sau khi append.
  - Probe Node in tổng layout, 7 ID tail và phân bố photo bucket.
  - `git diff --check -- layouts/library.json test/library.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Regression đầu tiên fail đúng vì 7 ID chưa có: 6/7 pass, 1 fail.
  - Library có đúng 32 layout; 25 ID cũ giữ nguyên prefix và thứ tự.
  - Bảy ID tail đúng thứ tự: `overlap_stack_duo`, `inset_card_hero`, `circle_trio_stagger`,
    `diagonal_staircase_trio`, `golden_column_pair`, `stacked_horizon_trio`,
    `offset_portrait_hero`.
  - Photo bucket 1/2/3 tăng đúng từ 6/5/6 lên 7/8/9; bucket 4/6/8/9 giữ 4/1/1/1.
  - Library tests 7/7 pass; diff check sạch.
- Metric trước/sau: Chưa đo `catalog.distinct` ở bước này; phép đo và nâng ratchet thuộc P1.5.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Append vào cuối duy nhất mảng `layouts`, ngay trước `montageBeats`; không append vào cuối file.
  - Chưa dùng kết quả validator làm nghiệm thu P1.3 trong bước này.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.3` — chạy validator G1–G8 trên library 32 layout và kiểm không có G4 offender mới.

### 2026-07-30 19:40 — P1.1

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Thêm đúng preset `circleMedallion` theo §6.1 của plan.
  - Khóa radius 260 và frame treatment bằng regression test.
  - Chưa thêm bảy primitive; phần đó thuộc P1.2.
- File dự kiến thay đổi:
  - `layouts/library.json`.
  - `test/library.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `layouts/library.json`.
  - `test/library.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/library.test.mjs` trước khi thêm preset.
  - `node --test --test-timeout=30000 test/library.test.mjs test/layout-primitive-validator.test.mjs`.
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - `git diff --check -- layouts/library.json test/library.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Regression đầu tiên fail đúng vì `circleMedallion` chưa tồn tại: 5/6 pass, 1 fail.
  - Preset mới có `radius:260`, `border:10`, `borderColor:"#FFFFFF"`, `shadow:true`.
  - `radius 260 = 520/2`, tạo hình tròn thật cho slot 520x520 và nằm dưới cap 400.
  - Library + validator tests 10/10 pass.
  - Validator library giữ 25/25 pass, 0 error, 20 warning cũ; diff check sạch.
- Metric trước/sau: Không đổi layout/geometry; chỉ thêm một named frame preset.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - `PRE-0.6` đã được session song song hoàn tất và commit trước khi lượt này nhận việc; không tạo bản ghi trùng.
  - Append preset sau `softCard`; không thay thứ tự hoặc nội dung preset cũ.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P1.2` — append đúng 7 primitive active vào cuối mảng `layouts`.

### 2026-07-30 19:40 — PRE-0.6 và đóng Pha 0 vào Git

- Session: Claude Code (session thứ hai, chạy song song với session Codex).
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đánh giá độc lập `P0C.6` bằng cách tự chạy lại toàn bộ gate mục 5.
  - Nhận `PRE-0.6` sau khi xác nhận session Codex đã dừng.
  - Commit toàn bộ Pha 0; trước bước này repo có 119 file dirty và **không một commit nào**.
  - Sửa hai điểm code đã nêu trong đánh giá.
  - Siết lại gate `P1.3` theo số G4 đo được.
- File đã thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs
    test/template-recipes.test.mjs test/layout-primitive-validator.test.mjs test/look-resolver.test.mjs`.
  - `npm run typecheck` và `npm run typecheck:scripts`.
  - `npm run test:unit` (hai lần: trước và sau refactor).
  - Harness in trực tiếp `geometryStats()` để đối chiếu số đo trước/sau refactor.
  - `git add`/`git reset`/`git commit` cho ba commit.
- Kết quả:
  - `P0C.6` xác minh độc lập: validator 25/25 với 0 error, lint 24/24, targeted 53/53,
    `npm run typecheck` exit 0, `test:unit` 352/352.
  - `PRE-0.6`: bảng mục 3 đã đủ 8 dòng; đo lại độc lập trả về đúng `catalog` 49/30/23 trên 258
    occurrence, `authored` 48/30/23 trên 233, `reachable` 49/30/23 với `over12Count` 7 trên 396,
    meaningful `cinematic-film-01:1`, `jmii-silk-botanical-01:3`, `white-weddings-full-01:1`.
  - Ba commit trên `agent/layout-primitives`:
    - `d5e8d0f` — snapshot source/fixture mà `PRE-0.3` đã import, tách riêng để ratchet có nguồn
      tái lập được. 110 file. `layouts/library.json` nằm ở commit này vì 24 recipe cần 25 layout
      của nó mới resolve được; chỉ dòng `meta.coordinateNote` thuộc `P0C.3`.
    - `b83d601` — toàn bộ Pha 0. 9 file.
    - `e43dad3` — refactor `geometryStats()`, bảo toàn hành vi.
  - Refactor: `geometryStats()` từng resolve mỗi main scene hai lần; nay truyền scene đã resolve
    vào `occurrenceOf()`, bỏ 233 trong 629 lời gọi `resolveScene()` mỗi lần chạy (37%).
  - Ghi rõ invariant ghép slot theo index trong `meaningfullyDiffers()`.
  - Gate `P1.3` siết lại: library hiện có **3 warning G4** trên layout cũ, nên "G1–G4 sạch" không
    thể xanh. Đã grandfather đúng 3 offender đó và đổi gate thành "không có offender G4 mới".
- Metric trước/sau: Không đổi. Toàn bộ số đo V2 giống hệt trước và sau refactor.
- Commit: `d5e8d0f`, `b83d601`, `e43dad3`.
- Quyết định hoặc sai lệch so với plan:
  - Tách commit baseline snapshot khỏi commit Pha 0 để phần Pha 0 review/cherry-pick được độc lập
    và để ratchet có nguồn tái lập trong lịch sử Git.
  - `d5e8d0f` **chưa được verify khi đứng một mình**: checkout một cây trung gian sẽ clobber
    session Codex đang giữ worktree này. Chỉ cây hợp nhất được verify (352/352).
  - Không sửa 3 slot G4 cũ trong Pha 1; đó là thay đổi geometry riêng, phải kèm nâng ratchet.
  - Không memoize `createTemplateTheme()` trong `slotShapeKey()`: `geometryStats()` chạy 21ms cho
    233 scene, chưa có vấn đề thực để tối ưu.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có. Pha 0 đóng.
- Bước tiếp theo: `P1.1` — thêm frame preset `circleMedallion`.

### 2026-07-30 19:29 — P0C.6

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Chạy nguyên bộ lệnh “Sau Pha 0” ở mục 5.
  - Chỉ sửa source nếu gate phát hiện lỗi trực tiếp thuộc Pha 0.
  - Nếu gate xanh, chỉ cập nhật tracker và bằng chứng.
- File dự kiến thay đổi:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs`.
  - `npm run typecheck`.
  - `git diff --check -- LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Validator: 25/25 layout pass, 0 error, 20 warning advisory.
  - Template lint: 24/24 sạch, 0 failing.
  - Targeted gate: 26/26 pass.
  - Full typecheck: core, GPU, scripts, web và server đều exit 0.
  - Không có failure nào cần sửa source.
- Metric trước/sau: Không đổi; baseline V2 đã đo ở P0A.5 vẫn là catalog 49, authored 48/30, reachable max 23 và over12 7.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Chạy đúng `npm run typecheck` rộng như tracker, không chỉ `typecheck:scripts`.
  - Chuyển bước tiếp theo về `PRE-0.6` vì mục này đã có số đo trong bảng nhưng trạng thái vẫn còn `TODO`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `PRE-0.6` — đối chiếu số P0A.5 với bảng mục 3 và chốt trạng thái baseline metric.

### 2026-07-30 19:19 — P0C.5

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Cài G1–G8 trong `validateLayoutPrimitive.mjs`.
  - G1/G2/G3/G6/G7/G8 là error; G4 và G5 là warning.
  - Candidate riêng kế thừa canvas, safe margin và frame preset từ library chuẩn.
  - Thêm fixture bắt từng gate và xác nhận warning không làm CLI exit 1.
- File dự kiến thay đổi:
  - `scripts/validateLayoutPrimitive.mjs`.
  - `test/layout-primitive-validator.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/validateLayoutPrimitive.mjs`.
  - `test/layout-primitive-validator.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-primitive-validator.test.mjs` trước khi export validator.
  - Nhiều lần `node --test --test-timeout=30000 test/layout-primitive-validator.test.mjs`.
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - `node --test --test-timeout=30000 test/layout-primitive-validator.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/look-resolver.test.mjs test/template-recipes.test.mjs`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `npm run typecheck:scripts`.
  - Đếm warning G4/G5 từ output validator.
  - `git diff --check -- scripts/validateLayoutPrimitive.mjs test/layout-primitive-validator.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Regression đầu tiên fail khi module chưa export `validateLayouts()`.
  - Fixture trực tiếp bắt đủ G1–G8; G1/G2/G3/G6/G7/G8 là error, G4/G5 là warning.
  - CLI exit 1 với candidate vi phạm G1 và giữ exit 0 khi chỉ có warning.
  - Library hiện tại: 25/25 layout pass, 0 error, 20 warning.
  - Trong đó G5 có 17 warning trên đúng 12/25 layout như số đo trong plan; G4 có 3 warning safe-margin.
  - Output in PASS/FAIL, coverage và % diện tích từng photo slot.
  - Targeted validator 4/4 pass; suite geometry/validator/library/resolver/template 53/53 pass.
  - Template lint 24/24 sạch; scripts typecheck exit 0; diff check sạch.
- Metric trước/sau: Không đổi metric V2; bổ sung baseline validator 25 pass / 0 fail.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - G4 là warning vì nguồn thiết kế ghi rõ đây là khuyến nghị; ba warning hiện hữu không làm library fail.
  - G5 luôn là warning; không dùng 17 finding hiện hữu làm error budget.
  - Full-bleed và layout không ảnh được miễn G2/G3 đúng theo `templateRules`; G6 bỏ background slot.
  - G8 chỉ chấp nhận named preset trỏ tới object thật, không coi trường metadata `note` là preset.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0C.6` — chạy toàn bộ gate Pha 0.

### 2026-07-30 19:16 — P0C.4

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Tạo CLI đọc một layout candidate hoặc object library có mảng `layouts`.
  - Báo lỗi rõ cho thiếu đối số, JSON sai hoặc input shape sai.
  - Thêm validator vào `tsconfig.scripts.json` và test đường chạy candidate/library.
  - Chưa cài finding G1–G8; phần đó thuộc P0C.5.
- File dự kiến thay đổi:
  - `scripts/validateLayoutPrimitive.mjs`.
  - `test/layout-primitive-validator.test.mjs`.
  - `tsconfig.scripts.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/validateLayoutPrimitive.mjs` (mới).
  - `test/layout-primitive-validator.test.mjs` (mới).
  - `tsconfig.scripts.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-primitive-validator.test.mjs` trước khi tạo CLI.
  - `node --test --test-timeout=30000 test/layout-primitive-validator.test.mjs`.
  - `node scripts/validateLayoutPrimitive.mjs layouts/library.json`.
  - `node --test --test-timeout=30000 test/layout-primitive-validator.test.mjs test/layout-geometry.test.mjs test/library.test.mjs test/look-resolver.test.mjs`.
  - `npm run typecheck:scripts`.
  - `npx tsc --noEmit -p tsconfig.scripts.json --listFilesOnly`.
  - `git diff --check -- scripts/validateLayoutPrimitive.mjs test/layout-primitive-validator.test.mjs tsconfig.scripts.json LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Regression run ban đầu 0/2 pass vì CLI chưa tồn tại.
  - CLI nạp được library hiện tại gồm 25 layout và candidate object đơn gồm 1 layout.
  - Input không có `layouts` array hoặc `id` bị từ chối với exit 1 và thông báo rõ.
  - Targeted CLI 2/2 pass; chạy cùng geometry/library/resolver đạt 36/36 pass.
  - Scripts typecheck exit 0; `--listFilesOnly` xác nhận có `validateLayoutPrimitive.mjs`; diff check sạch.
- Metric trước/sau: Không đổi geometry hoặc metric V2.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Candidate được định nghĩa là một layout object có `id`; library là object có mảng `layouts`.
  - CLI chỉ dựng input/output và lỗi cấu trúc ở bước này; chưa phát finding G1–G8.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0C.5` — cài G1–G8, trong đó G5 chỉ warning.

### 2026-07-30 19:12 — P0C.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Sửa `meta.coordinateNote` để phản ánh biên cứng và rotated bounds.
  - Làm rõ comment đầu resolver về invariant canvas.
  - Thêm test chống metadata quay lại cho phép toạ độ âm.
  - Không đổi geometry hoặc recipe.
- File dự kiến thay đổi:
  - `layouts/library.json`.
  - `scripts/lib/lookResolver.mjs`.
  - `test/library.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `layouts/library.json`.
  - `scripts/lib/lookResolver.mjs`.
  - `test/library.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/library.test.mjs` trước khi sửa metadata.
  - `node --test --test-timeout=30000 test/library.test.mjs test/look-resolver.test.mjs test/layout-geometry.test.mjs`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `npm run typecheck:scripts`.
  - `rg -n -i "negative x/y intentionally|negative x/y are deliberate|negative coordinates are deliberate" layouts scripts src test docs`.
  - `git diff --check -- layouts/library.json scripts/lib/lookResolver.mjs test/library.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Metadata regression ban đầu fail đúng câu cũ cho phép x/y âm: 4/5 pass, 1 fail.
  - `coordinateNote` nay yêu cầu x/y không âm, rendered bounds sau rotation nằm trong canvas và định nghĩa full-bleed là phủ kín chứ không vượt biên.
  - Comment đầu resolver mô tả cùng invariant rendered bounds.
  - Geometry + library + resolver 34/34 pass; lint 24/24 template sạch; scripts typecheck exit 0.
  - Không còn câu cho phép toạ độ âm trong `layouts/`, `scripts/`, `src/`, `test/`, `docs/`; diff check sạch.
- Metric trước/sau: Không đổi geometry hoặc metric V2.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Giữ nguyên các từ “full-bleed” mô tả ảnh phủ kín canvas; chúng không cho phép geometry vượt canvas.
  - Chỉ sửa một trường metadata trong `library.json`; các thay đổi khác đang có trong file thuộc session trước.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0C.4` — tạo `scripts/validateLayoutPrimitive.mjs` chạy được trên candidate và library.

### 2026-07-30 19:10 — P0C.2

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Dùng `rotatedSlotBounds()` khi kiểm biên primitive trong library.
  - Dùng cùng bounding box khi V4 kiểm geometry của look đã resolve.
  - Thêm regression test cho rotation âm có raw rectangle hợp lệ nhưng rendered bounds tràn canvas.
  - Chưa sửa comment đầu file hoặc `meta.coordinateNote`; phần đó thuộc P0C.3.
- File dự kiến thay đổi:
  - `scripts/lib/lookResolver.mjs`.
  - `test/library.test.mjs`.
  - `test/look-resolver.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/lookResolver.mjs`.
  - `test/library.test.mjs`.
  - `test/look-resolver.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Probe in-memory quét bounds sau rotation của toàn bộ primitive và scene đã resolve.
  - `node --test --test-timeout=30000 test/library.test.mjs test/look-resolver.test.mjs` trước khi nối helper vào V4.
  - `node --test --test-timeout=30000 test/library.test.mjs test/look-resolver.test.mjs test/layout-geometry.test.mjs`.
  - `node scripts/lintStoryTemplates.mjs`.
  - `npm run typecheck:scripts`.
  - `git diff --check -- scripts/lib/lookResolver.mjs test/library.test.mjs test/look-resolver.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Probe trước thay đổi: 0 primitive và 0 resolved scene hiện hữu có rotated bounds tràn canvas.
  - Regression run ban đầu fail đúng resolved look xoay -45°: 26/27 pass, 1 fail.
  - V4 dùng `rotatedSlotBounds()` trước khi so bốn cạnh canvas; finding ghi cả kích thước render và góc xoay.
  - Gate library cũng dùng rendered bounds; fixture primitive -30° chứng minh raw rectangle hợp lệ nhưng rotated bounds bị chặn.
  - Geometry + library + resolver 33/33 pass; lint 24/24 template sạch; scripts typecheck exit 0.
  - Diff check sạch; Git chỉ cảnh báo line-ending LF/CRLF hiện hữu.
- Metric trước/sau: Rotated-bound offender hiện hữu giữ nguyên 0 primitive / 0 resolved scene.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Gate primitive được nối vào `test/library.test.mjs`; CLI G1–G8 vẫn để đúng P0C.4–P0C.5.
  - Dùng chung helper production để primitive và resolved look không lệch công thức.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0C.3` — sửa comment và `meta.coordinateNote` để không còn cho phép toạ độ âm.

### 2026-07-30 19:06 — P0C.1

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đổi V4 của `validateLook()` từ ngưỡng còn 50% trên màn hình sang đúng biên cứng của preflight.
  - Thêm regression test cho bốn cạnh canvas và trường hợp nằm đúng biên.
  - Chưa kiểm bounding box sau rotation; phần đó thuộc P0C.2.
- File dự kiến thay đổi:
  - `scripts/lib/lookResolver.mjs`.
  - `test/look-resolver.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/lookResolver.mjs`.
  - `test/look-resolver.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/look-resolver.test.mjs` trước khi sửa production code.
  - `node --test --test-timeout=30000 test/look-resolver.test.mjs` sau khi sửa.
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs test/look-resolver.test.mjs test/library.test.mjs`.
  - `npm run typecheck:scripts`.
  - `git diff --check -- scripts/lib/lookResolver.mjs test/look-resolver.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Regression test ban đầu fail đúng tại overflow trái 1px: 22/23 pass, 1 fail.
  - V4 nay phát lỗi khi geometry đã resolve có `x < 0`, `y < 0`, vượt phải hoặc vượt dưới.
  - Slot nằm đúng bốn biên vẫn hợp lệ; slot nền full-bleed bị override cũng không còn được bỏ qua.
  - Targeted look-resolver 23/23 pass; geometry + resolver + library 32/32 pass.
  - Toàn bộ recipe hiện hữu tiếp tục resolve sạch trong suite; scripts typecheck exit 0; diff check sạch.
- Metric trước/sau: Không đổi metric V2; số recipe hiện hữu có slot tràn canvas vẫn là 0.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Giữ kiểm tra ở raw resolved rectangle để khớp đúng phạm vi P0C.1.
  - Chưa dùng `rotatedSlotBounds()` trong V4; enforcement sau rotation thuộc P0C.2.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0C.2` — kiểm bounding box sau rotation trên primitive và resolved look.

### 2026-07-30 19:02 — P0B.6

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Thêm helper thuần tính bounding box sau rotation.
  - Test góc âm bắt buộc dùng trị tuyệt đối và phát hiện right/bottom thực tế.
  - Chưa dùng helper để phát finding V4; phần enforcement thuộc P0C.2.
- File dự kiến thay đổi:
  - `scripts/lib/lookResolver.mjs`.
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/lookResolver.mjs`.
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs test/look-resolver.test.mjs`.
  - `npm run typecheck:scripts`.
  - `git diff --check -- scripts/lib/lookResolver.mjs test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Thêm `rotatedSlotBounds()` mô phỏng đúng output size của FFmpeg `rotate`.
  - Công thức dùng `abs(cos)` và `abs(sin)` nên góc -30° và +30° cho cùng width/height.
  - Fixture chứng minh slot chưa xoay nằm trong canvas nhưng bounding box sau -30° vượt biên phải.
  - Layout geometry 6/6 pass; chạy cùng look-resolver đạt 29/29; scripts typecheck exit 0.
  - Diff check sạch; Git chỉ in cảnh báo line-ending LF/CRLF hiện hữu cho `lookResolver.mjs`.
- Metric trước/sau: Không đổi metric V2; bổ sung regression coverage cho G7.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Thêm helper tính toán thuần trong `lookResolver.mjs` để test chạm production code.
  - Helper chưa phát finding V4/G7; integration vào validation thuộc P0C.2.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0C.1` — siết V4 về đúng biên preflight.

### 2026-07-30 18:56 — P0B.5

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Thêm fixture geometry riêng cho main, `muteFallback`, repeatable variant.
  - Chứng minh fallback/variant key không thuộc authored nhưng thuộc reachable.
  - Chưa thêm test rotation âm/bounding box.
- File dự kiến thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs`.
  - `git diff --check -- test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Fixture dùng ba layout có geometry key riêng cho main/fallback/variant.
  - Hai key chỉ-fallback/chỉ-variant được xác nhận không có trong `authored`.
  - Hai key xuất hiện trong `reachable` với source lần lượt là `muteFallback`,
    `repeatableVariant`.
  - File test 5/5 pass; diff check sạch.
- Metric trước/sau: Không đổi baseline thật; fixture có authored 1 key / reachable 3 key.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Dùng fixture in-memory tối thiểu, không thêm JSON artefact hoặc phụ thuộc recipe thật.
  - Chưa thêm test rotation/bounding box; giữ đúng phạm vi P0B.6.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0B.6` — thêm test rotation âm và bounding box.

### 2026-07-30 18:54 — P0B.4

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Thêm ratchet số key V2 riêng cho layout `closing_names`.
  - Khoá trần nhóm recipe lớn nhất ở 9.
  - Chưa thêm fixture reachable fallback/variant.
- File dự kiến thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs`.
  - `git diff --check -- test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Lọc occurrence authored theo layout đã resolve `closing_names`.
  - Khử trùng recipe trong từng key trước khi tính kích thước nhóm.
  - Ratchet giữ đúng 11 key V2 và `maxGroup <= 9`.
  - File test 4/4 pass; diff check sạch.
- Metric trước/sau: `closing_names` giữ 11 key, nhóm lớn nhất 9.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Không dựa vào tên scene hoặc text content; dùng layout/key đã resolve từ report metric.
  - Chưa thêm fixture fallback/variant; giữ đúng phạm vi P0B.5.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0B.5` — thêm fixture chỉ xuất hiện trong fallback/variant.

### 2026-07-30 18:52 — P0B.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Thêm ratchet `catalog.distinct`, `authored.distinct`.
  - Thêm trần `reachable.maxShare`, `reachable.over12Count`.
  - Chưa thêm ratchet riêng `closing_names`.
- File dự kiến thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs`.
  - `git diff --check -- test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Khoá sàn `catalog.distinct >= 49`, `authored.distinct >= 48`.
  - Khoá trần `reachable.maxShare <= 23`, `reachable.over12Count <= 7`.
  - Chuyển `geometryStats()` thành phép tính dùng chung một lần cho các test trong file.
  - File test 3/3 pass; diff check sạch.
- Metric trước/sau: Không đổi baseline; 49/48/23/7 đã thành ratchet CI.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Không khoá `authored.shared=30`: chỉ số này cần được phép giảm trong Pha 2.
  - Chưa thêm ratchet `closing_names`; giữ đúng phạm vi P0B.4.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0B.4` — thêm chống hồi quy `closing_names`.

### 2026-07-30 18:49 — P0B.2

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Nạp library và 24 recipe thật trong `test/layout-geometry.test.mjs`.
  - Thêm ratchet meaningful per recipe với baseline 1/3/1 đã đo.
  - Chưa thêm ratchet `catalog/authored/reachable`.
- File dự kiến thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs`.
  - `git diff --check -- test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Test nạp 24 recipe và library thật, gọi `geometryStats()` một lần.
  - Ratchet giữ sàn `cinematic-film-01:1`, `jmii-silk-botanical-01:3`,
    `white-weddings-full-01:1`; recipe khác giữ sàn 0.
  - Dùng điều kiện `>=` để cho phép số meaningful tăng ở các batch migration sau.
  - File test 2/2 pass; diff check sạch.
- Metric trước/sau: Meaningful baseline được khoá ở 5 scene / 3 recipe.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Chỉ thêm ratchet meaningful; chưa thêm ngưỡng scope thuộc P0B.3.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0B.3` — thêm ratchet `catalog/authored/reachable`.

### 2026-07-30 18:48 — P0B.1

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Tạo scaffold `test/layout-geometry.test.mjs`.
  - Xác nhận Node test runner nhận file và import đủ bốn helper metric.
  - Chưa thêm baseline meaningful, ratchet scope hoặc fixture reachable.
- File dự kiến thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `test/layout-geometry.test.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `node --test --test-timeout=30000 test/layout-geometry.test.mjs`.
  - `git diff --check -- test/layout-geometry.test.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Node test runner nhận file mới.
  - Smoke test import được đủ `geometryKey`, `slotShapeKey`, `meaningfullyDiffers`,
    `geometryStats`; 1/1 pass.
  - Diff check sạch.
- Metric trước/sau: Không đổi metric; đây là bước scaffold test.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Chỉ thêm smoke wiring ở P0B.1; chưa đưa ratchet của P0B.2–P0B.6 vào sớm.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0B.2` — thêm baseline meaningful per recipe.

### 2026-07-30 18:42 — P0A.5

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Cài `geometryStats(recipes, library)` cho `catalog`, `authored`, `reachable`, `perRecipe`.
  - Khử trùng lặp recipe/key khi tính `shared`, `maxShare`, `over12Count`.
  - Giữ toàn bộ occurrence main/fallback/repeat variant cho report.
  - Chưa tạo test ratchet `test/layout-geometry.test.mjs`.
- File dự kiến thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Assertion harness trên 24 recipe thật cho toàn bộ baseline V2.
  - Assertion fixture tổng hợp có main, `muteFallback`, repeatable variant và scene lặp cùng key.
  - `npm run typecheck:scripts`.
  - `node --test --test-timeout=30000 test/look-resolver.test.mjs test/template-theme.test.mjs`.
  - `git diff --check -- scripts/lib/geometrySignature.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - `catalog`: 49 distinct, 30 shared, maxShare 23; 258 occurrence.
  - `authored`: 48 distinct, 30 shared, maxShare 23; đúng 233 scene chính.
  - `reachable`: 49 distinct, 30 shared, maxShare 23, over12Count 7; 396 occurrence.
  - Bảy nhóm reachable trên 12 recipe có share `23, 15, 15, 14, 14, 13, 13`.
  - `perRecipe` trả về summary authored/reachable cùng meaningful count và danh sách scene.
  - Meaningful baseline giữ đúng `cinematic-film-01:1`, `jmii-silk-botanical-01:3`,
    `white-weddings-full-01:1`.
  - Fixture chứng minh fallback/variant tạo key reachable riêng; hai scene cùng key trong một recipe
    vẫn chỉ tăng share một lần nhưng cả hai occurrence đều còn trong report.
  - Scripts typecheck exit 0; look-resolver + template-theme 25/25 pass; diff check sạch.
- Metric trước/sau: Toàn bộ baseline V2 trong mục 3 đã được xác nhận trên source hiện tại.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - `catalog` là union 25 layout library và 233 scene chính đã resolve.
  - Mỗi summary giữ `groups[].occurrences` đầy đủ nhưng `share` dùng tập recipe duy nhất theo key.
  - Dùng assertion harness ở bước implementation; test ratchet bền vững bắt đầu ở `P0B.1`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0B.1` — tạo `test/layout-geometry.test.mjs`.

### 2026-07-30 18:35 — P0A.4

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Cài `meaningfullyDiffers(resolvedScene, baseLayout, template, library, canvas)`.
  - Áp ngưỡng photo geometry 1% theo trục, rotation 1° và silhouette.
  - Kiểm chứng nudge 1px không được tính meaningful.
  - Chưa cài `geometryStats()`.
- File dự kiến thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Assertion harness trực tiếp cho ngưỡng `meaningfullyDiffers()` và meaningful baseline 24 recipe.
  - `npm run typecheck:scripts`.
  - `node --test --test-timeout=30000 test/look-resolver.test.mjs test/template-theme.test.mjs`.
  - `git diff --check -- scripts/lib/geometrySignature.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Nudge 1px và delta ngay dưới 1%/1° trả về `false`.
  - Delta đúng hoặc vượt 1% theo từng trục, rotation ±1° và đổi silhouette trả về `true`.
  - Thay đổi border/color/shadow hoặc chỉ text/background không được tính vào gate adoption.
  - Meaningful baseline khớp plan: `cinematic-film-01:1`,
    `jmii-silk-botanical-01:3`, `white-weddings-full-01:1`; 21 recipe còn lại bằng 0.
  - Scripts typecheck exit 0; look-resolver + template-theme 25/25 pass; diff check sạch.
  - Assertion đầu tiên bắt sai số floating-point tại đúng biên 10.8px; đã thêm tolerance tương đối
    cực nhỏ và gate cuối xanh cả trường hợp ngay dưới/ngay tại ngưỡng.
- Metric trước/sau: Meaningful baseline = 5 scene / 3 recipe, đúng số đã chốt trong plan.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Gate meaningful chỉ đo photo geometry + silhouette. Text/panel/background thuộc Key V2 nhưng
    không được tính là custom photo geometry cho G2; cách này tái tạo chính xác baseline 1/3/1.
  - Dùng assertion harness ở bước implementation; test ratchet bền vững
    `test/layout-geometry.test.mjs` vẫn thuộc `P0B.1`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0A.5` — cài `geometryStats()` cho `catalog/authored/reachable/perRecipe`.

### 2026-07-30 18:27 — P0A.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Cài `slotShapeKey(resolvedScene, template, library)`.
  - Bám đúng precedence renderer: scene slot → look → layout slot.
  - Kiểm chứng phân loại silhouette `rect/circle/pill`.
  - Chưa cài `meaningfullyDiffers()` hoặc `geometryStats()`.
- File dự kiến thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Assertion harness trực tiếp cho `slotShapeKey()`, gồm fixture tổng hợp và 24 recipe thật.
  - `npm run typecheck:scripts`.
  - `node --test --test-timeout=30000 test/look-resolver.test.mjs test/template-theme.test.mjs`.
  - `git diff --check -- scripts/lib/geometrySignature.mjs LAYOUT-PRIMITIVES-PROGRESS.md`.
- Kết quả:
  - Silhouette trả về đúng `rect`, `circle`, `pill`; rounded rectangle thông thường vẫn là `rect`.
  - Precedence đúng renderer: `scene.photoSlots[].frame` → `resolvedFrame` của look → `slot.frame`.
  - Preset recipe được ưu tiên trước `designTokens.framePreset` nhờ dùng chung `resolveFrame()`.
  - Border, borderColor và shadow không làm đổi shape key.
  - Photo slot dùng làm full-bleed background luôn là `rect`; closing bookend vẫn bám hành vi renderer.
  - Quét sạch 233 `layer_scene` thuộc 24 recipe thật, thu được 8 shape key phân biệt.
  - Scripts typecheck exit 0; look-resolver + template-theme 25/25 pass; diff check sạch.
  - Lần typecheck đầu phát hiện thiếu `direction` tường minh ở lời gọi helper; đã sửa và gate cuối xanh.
- Metric trước/sau: Chưa chạy `geometryStats()`; kiểm chứng phụ 233 scene thật / 8 shape key.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Dùng trực tiếp `createTemplateTheme().resolveFrame` để metric và renderer không có hai cách
    resolve preset khác nhau.
  - Dùng assertion harness ở bước implementation; test ratchet bền vững
    `test/layout-geometry.test.mjs` vẫn thuộc `P0B.1`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0A.4` — cài `meaningfullyDiffers()`.

### 2026-07-30 18:23 — P0A.2

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Cài `geometryKey(resolvedLayout, canvas)` theo Key V2.
  - Kiểm chứng lượng tử hoá, trường được giữ/bỏ và text-only layout.
  - Chưa cài `slotShapeKey()`, `meaningfullyDiffers()` hoặc `geometryStats()`.
- File dự kiến thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Assertion harness trực tiếp cho Key V2.
  - `npm run typecheck:scripts`.
  - `node --test --test-timeout=30000 test/look-resolver.test.mjs`.
- Kết quả:
  - `geometryKey()` giữ thứ tự slot/panel và lượng tử hoá ngang/dọc theo 1% canvas,
    rotation theo 1°.
  - Key gồm photo geometry, text geometry, panel type/geometry/z và background type/slot.
  - Key bỏ qua id, frame, fit, grade, màu, opacity, font/style và nội dung chữ.
  - Nudge 1px giữ nguyên key trên fixture; dịch 1% canvas, rotation 1°, đổi panel z,
    text geometry hoặc background đều đổi key.
  - 24 scene `closing_names` cho 11 key phân biệt; nhóm lớn nhất 9.
  - Scripts typecheck exit 0; look-resolver 23/23 pass.
- Metric trước/sau: Xác nhận riêng `closing_names`: 11 key, max share 9; chưa chạy `geometryStats()`.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Dùng assertion harness ở bước implementation; test ratchet bền vững
    `test/layout-geometry.test.mjs` vẫn thuộc `P0B.1`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0A.3` — cài `slotShapeKey()` theo frame precedence thật.

### 2026-07-30 18:19 — P0A.1

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Tạo module ESM `scripts/lib/geometrySignature.mjs`.
  - Thêm module vào phạm vi `tsconfig.scripts.json`.
  - Chưa cài bốn hàm metric thuộc `P0A.2–P0A.5`.
- File dự kiến thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `tsconfig.scripts.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `scripts/lib/geometrySignature.mjs`.
  - `tsconfig.scripts.json`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `npm run typecheck:scripts`.
  - Import module trực tiếp bằng Node.
  - `npx tsc --noEmit -p tsconfig.scripts.json --listFilesOnly`.
  - `git diff --check`.
- Kết quả:
  - Module ESM import thành công.
  - `tsc --listFilesOnly` có `scripts/lib/geometrySignature.mjs`.
  - Scripts typecheck exit 0.
  - `git diff --check` sạch.
- Metric trước/sau: Chưa áp dụng; P0A.1 chỉ dựng module/typecheck boundary.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Không thêm stub API có thể bị gọi nhầm; từng export sẽ được thêm cùng implementation/test ở
    `P0A.2–P0A.5`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0A.2` — cài `geometryKey()` với photo/text/panel/background.

### 2026-07-30 18:10 — PRE-0.5

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Chạy Premium dry-run trên fixture và invocation đã ghim ở `PRE-0.4`.
  - Tắt ba provider key trong riêng process chạy để buộc chế độ STUB.
  - Lưu stdout nguyên bản vào `temp/premium-before.txt` và kiểm tra artefact.
- File dự kiến thay đổi:
  - `temp/premium-before.txt`.
  - Artefact phân tích/timeline bên trong project fixture bị Git ignore.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `temp/premium-before.txt` — snapshot được chấp nhận.
  - `temp/premium-before.failed-20260730-1810.txt` và
    `temp/premium-before.failed-20260730-1812.txt` — giữ log hai lần fixture bị duplicate collapse.
  - `temp/premium-before.rejected-card5-20260730-1815.txt` — giữ snapshot kỹ thuật xanh nhưng có card 5 ảnh.
  - `projects/layout-primitives-premium-baseline/input/` và các artefact analysis/timeline bị Git ignore.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Ba lần invocation Premium đã ghim với provider keys rỗng trong process.
  - `analyzePhotos.mjs` để kiểm tra orientation và duplicate groups trước khi chạy lại.
  - `ffprobe`, SHA-256 và script đọc timeline để xác nhận shape baseline.
- Kết quả:
  - Hai lần đầu exit 1 vì ảnh synthetic ban đầu bị perceptual duplicate detector gộp còn quá ít
    representative cho allocator; không phải lỗi library.
  - Sau khi tạo lại ảnh bằng seed độc lập, 81 ảnh đều assignable; dry-run exit 0 nhưng bị loại
    vì còn một `collage_grid` 5 ảnh.
  - Fixture cuối có 82 ảnh, 0 duplicate group; Premium dry-run exit 0 và job manifest `completed`.
  - Timeline baseline: 38 scene, 188.83 giây, dùng 82/82 ảnh, 0 ảnh bỏ lại.
  - Phân bố số ảnh/scene: 1 scene không ảnh, 28 scene một ảnh, 9 scene sáu ảnh.
  - Không có card 4/5 ảnh.
  - Effect counts: `layer_scene` 5; `film_roll_up` 3; `slow_zoom_in` 4; `memory_wall` 3;
    `kenburns_tl` 4; `pan_right` 4; `collage_grid` 3; `slow_zoom_out` 3;
    `dark_feather` 3; `portrait_blur_background` 3; `circle_focus` 3.
  - `temp/premium-before.txt`: 30.418 byte; SHA-256
    `3549F96C5C231E9DFA11F6406402932F3F7E17FD1EB5ED505B79D029D2DBD883`.
  - Fingerprint tập 82 ảnh:
    `EB235370D1F42416C77AF07F767C156CDCB3E6D28E893C0E4C17FC8243647DEB`.
- Metric trước/sau: Chưa áp dụng metric geometry V2; đây là Premium behavior baseline.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Điều chỉnh fixture trước khi chấp nhận snapshot để không mang duplicate collapse hoặc card 5 ảnh
    vào baseline so sánh.
  - Không sửa engine/library trong bước này; mọi thay đổi fixture nằm dưới đường dẫn bị Git ignore.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `P0A.1` — tạo `scripts/lib/geometrySignature.mjs`.

### 2026-07-30 18:04 — PRE-0.4

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Kiểm kê các project Premium hiện có trong worktree triển khai.
  - Chọn một project/job có input và config ổn định để dùng cho so sánh trước/sau.
  - Chỉ ghi nhận lựa chọn; chưa chạy Premium dry-run của `PRE-0.5`.
- File đã thay đổi:
  - `projects/layout-primitives-premium-baseline/` — fixture project bị Git ignore, tạo bằng CLI chuẩn.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Kiểm kê `project.json` và asset của các project hiện có trong worktree nguồn.
  - `npm run project:create -- --id layout-primitives-premium-baseline ... --tier premium`.
  - Nạp manifest bằng `loadProject()` để kiểm tra schema và asset path.
  - Đếm asset, đo thời lượng nhạc và tính SHA-256 cho project, prompt, nhạc và tập ảnh.
- Kết quả:
  - Không có project Premium sẵn có; các project người dùng là Template và hai fixture nhỏ là Lite.
  - Đã tạo fixture Premium riêng với 81 ảnh, một track dài 188.830 giây và prompt cố định.
  - `loadProject()` chấp nhận manifest; đủ 81/81 ảnh và 1/1 track.
  - Project nằm dưới `projects/` và được `.gitignore` bao phủ; không nhập output/cache cũ.
  - Đã ghim `choice=A`, `music-choice=full` và provider STUB cho phép so sánh tất định.
- Metric trước/sau: Không áp dụng; fingerprint đã ghi ở mục Premium job cố định.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Tạo fixture mới trong worktree cô lập vì không có job Premium phù hợp để chọn lại.
  - Dùng fixture synthetic nhỏ, tự chứa thay vì sao chép project người dùng 90–160 MB.
  - Không chạy dry-run; giữ đúng ranh giới với `PRE-0.5`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `PRE-0.5` — chạy invocation đã ghim và lưu `temp/premium-before.txt`.

### 2026-07-30 17:50 — Dựng lại baseline cho PRE-0.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đo gate trên worktree nguồn để xác nhận chất lượng nguồn.
  - Chỉ chuyển source/fixture trực tiếp giải thích các failure hiện có.
  - Chạy lại `npm run check`.
- File đã thay đổi:
  - 95 file source/test/template liên quan trực tiếp dưới `layouts/`, `scripts/`, `src/`, `story-templates/`, `test/`, `gpu-effects/` và `public/gpu-effects/`.
  - Fixture kiểm thử: 81 ảnh JPEG 1920x1080 khác nhau trong `input/`; 2 MP3 và analysis tương ứng; 5 font/asset/analysis có sẵn từ worktree nguồn; `analysis/photos.json` tối thiểu 6 ảnh.
  - `gpu-effects/fonts.ts`: bổ sung cast cục bộ cho `FontFaceSet.add` còn thiếu trong DOM typings hiện tại; không đổi hành vi runtime.
  - `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - Targeted: `node --test --test-timeout=30000 test/music-extend.test.mjs test/tier1-retime-seam.test.mjs test/tilt-shift.test.mjs test/vision-cache.test.mjs`.
  - `npm run test:unit`.
  - `node --test --test-timeout=30000 test/recipe-nodes.test.mjs`.
  - `npm run typecheck:gpu`.
  - `npm run test:api`.
  - `npm run check`.
- Kết quả:
  - Targeted suite: 21/21 pass.
  - Recipe-node suite: 8/8 pass.
  - Gate cuối `npm run check`: `CHECK_EXIT=0`.
  - Typecheck, build và docs check đều xanh.
  - API: 74/74 pass.
  - Unit: 340/340 pass.
  - Integration: 1/1 pass.
  - Production audit: 0 vulnerability.
- Metric trước/sau: Không áp dụng cho PRE-0.3.
- Commit: Chưa commit; HEAD vẫn là `82d59a5`.
- Quyết định hoặc sai lệch so với plan:
  - Theo phê duyệt tiếp tục của người dùng, nhập snapshot source/fixture tối thiểu từ worktree nguồn để dựng một baseline tự nhất quán.
  - Không nhập toàn bộ thay đổi ngoài phạm vi; không thay `package.json` hoặc `scripts/checkDocs.mjs`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `PRE-0.4` — chọn một Premium job cố định và ghi project/job cùng config.

### 2026-07-30 17:41 — Gỡ blocker PRE-0.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đối chiếu 10 lỗi TypeScript với source và thay đổi web hiện có.
  - Chỉ đưa vào tập sửa tối thiểu để baseline web nhất quán.
  - Chạy `npm run typecheck:web`, sau đó chạy lại toàn bộ `npm run check`.
- File dự kiến thay đổi: các module/prop contract web trực tiếp gây lỗi và `LAYOUT-PRIMITIVES-PROGRESS.md`.
- File đã thay đổi:
  - `apps/web/src/App.tsx`
  - `apps/web/src/AssetsPage.tsx`
  - `apps/web/src/JobRunnerPanel.tsx`
  - `apps/web/src/components/LazyApiImage.tsx`
  - `apps/web/src/components/RecipeSwatch.tsx`
  - `apps/web/src/planFormat.ts`
  - `apps/web/src/recipeFormat.ts`
  - `server/app.ts`
  - `server/requestHelpers.ts`
  - `server/services/analysis.ts`
  - `server/services/jobs.ts`
  - `server/services/rateLimit.ts`
  - `LAYOUT-PRIMITIVES-PROGRESS.md`
- Lệnh đã chạy:
  - `npm run typecheck:web`
  - `npm run typecheck:server`
  - `npm run test:api`
  - Ba lần `node --import tsx --test server/services/jobs.test.ts`
  - `npm run check`
- Kết quả:
  - Gỡ toàn bộ 10 lỗi `typecheck:web`; web typecheck xanh.
  - Sửa public job contract, auth rate limit và race khi hủy job.
  - `test:api`: 74/74 pass.
  - `server/services/jobs.test.ts`: 4/4 pass trong ba lần liên tiếp.
  - Lần chạy `npm run check` cuối: typecheck, build, docs và API tests xanh; dừng tại `test:unit` với 253 pass, 47 fail, 1 skip.
  - Nhóm failure chính:
    - thiếu layout `gallery_matte_hero`, làm hỏng resolver và 24 recipe;
    - thiếu thư mục fixture `input/` và `analysis/music/Em Đồng Ý (I Do).json`;
    - implementation/test của music extension, native effects, vision cache và template scaling không cùng baseline.
- Metric trước/sau: Không áp dụng.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Chỉ port bản sửa web/API nhỏ, có gate trực tiếp.
  - Không nhập toàn bộ source, fixture và asset chưa commit từ worktree cũ vì đó là thay đổi phạm vi lớn, không thể suy ra là baseline merge được duyệt.
- Trạng thái kết thúc: `BLOCKED`.
- Blocker còn lại:
  - Commit `82d59a5` không phải baseline tự chứa đầy đủ để chạy test suite.
  - Cần chọn một commit baseline khác hoặc phê duyệt tập thay đổi/fixture cụ thể từ worktree cũ.
- Bước tiếp theo: Sau khi chốt chiến lược baseline, chạy lại `npm run check` và chỉ đánh dấu `PRE-0.3` `DONE` khi toàn gate xanh.

### 2026-07-30 17:37 — PRE-0.3

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Cài dependencies trong worktree nếu cần.
  - Chạy đúng `npm run check` trên baseline `82d59a5`.
  - Chỉ ghi nhận kết quả; không sửa failure ngoài phạm vi bước này.
- File dự kiến thay đổi: `LAYOUT-PRIMITIVES-PROGRESS.md`; `node_modules/` có thể được tạo và được Git ignore.
- File đã thay đổi: `LAYOUT-PRIMITIVES-PROGRESS.md`; `node_modules/` được tạo và được Git ignore.
- Lệnh đã chạy:
  - `npm ci`
  - `npm run check`
  - `git status --short`
- Kết quả:
  - `npm ci`: thành công, thêm 320 package, audit 321 package, 0 vulnerability.
  - `npm run check`: thất bại với exit code 1 tại `npm run typecheck:web`; build, docs, tests và production audit chưa chạy.
  - TypeScript báo 10 lỗi trong `apps/web/src/App.tsx`, `apps/web/src/AssetsPage.tsx` và `apps/web/src/RecipeLibrary.tsx`.
  - Bốn module được import nhưng không tồn tại trên baseline: `components/LazyApiImage`, `components/RecipeSwatch`, `recipeFormat`, `planFormat`.
  - Các prop không khớp gồm `onBack`, `music`, `styleName`, `renderBlocked`, `blockedReason`, `onUpgrade`.
  - Sau `npm ci`, Git chỉ thấy hai tài liệu layout untracked; `package.json` và `package-lock.json` không đổi.
- Metric trước/sau: Không áp dụng.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Không sửa lỗi baseline trong bước đo.
  - Không sao chép các file web untracked từ worktree cũ vì chưa có bằng chứng đó là baseline merge đã được duyệt.
- Trạng thái kết thúc: `BLOCKED`.
- Blocker còn lại:
  - Cần đưa phần web phụ thuộc vào một commit baseline sạch hoặc chọn lại baseline đã chứa đầy đủ các module/prop contract, rồi chạy lại `npm run check`.
- Bước tiếp theo: Gỡ blocker baseline web, sau đó chạy lại `PRE-0.3`.

### 2026-07-30 16:28 — PRE-0.2

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Đưa `LAYOUT-PRIMITIVES-PLAN.md` và `LAYOUT-PRIMITIVES-PROGRESS.md` vào worktree triển khai.
  - Xác nhận cả hai file mở được từ worktree mới.
  - Chưa chạy `npm run check` của `PRE-0.3`.
- File dự kiến thay đổi:
  - `LAYOUT-PRIMITIVES-PLAN.md`
  - `LAYOUT-PRIMITIVES-PROGRESS.md`
- File đã thay đổi:
  - `LAYOUT-PRIMITIVES-PLAN.md`
  - `LAYOUT-PRIMITIVES-PROGRESS.md`
- Lệnh đã chạy:
  - Sao chép hai file bằng `Copy-Item -LiteralPath` sau khi xác nhận đích chưa tồn tại.
  - Trong worktree mới: `Get-Item`, `Get-Content -TotalCount 1 -Encoding utf8`, `Get-FileHash -Algorithm SHA256`.
  - `git status --short`.
- Kết quả:
  - `LAYOUT-PRIMITIVES-PLAN.md` mở được, 66.777 byte, SHA-256 `BF226D0E810ACBF13EC30E97CD6A6D9AB38186AC512D2AE0BA71DFF0271BFA2A`.
  - `LAYOUT-PRIMITIVES-PROGRESS.md` mở được từ worktree mới.
  - Hai file hiện là untracked trên branch `agent/layout-primitives`; không có thay đổi code nào trong worktree triển khai.
- Metric trước/sau: Không áp dụng.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Giữ hai tài liệu untracked trong bước này; việc chạy baseline check thuộc `PRE-0.3`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `PRE-0.3` — chạy `npm run check` trên baseline sạch.

### 2026-07-30 16:25 — PRE-0.1

- Session: Codex.
- Trạng thái nhận việc: `IN_PROGRESS`.
- Phạm vi:
  - Chọn baseline từ lịch sử Git hiện có.
  - Tạo branch/worktree sạch, không thay đổi worktree bẩn hiện tại.
  - Chỉ cập nhật tracker; chưa chạy gate của `PRE-0.3`.
- File đã thay đổi: `LAYOUT-PRIMITIVES-PROGRESS.md`.
- Lệnh đã chạy:
  - `git status --short`
  - `git log --oneline --decorate -12`
  - `git worktree add -b agent/layout-primitives D:\Claude\Projects\SlideshowRenderEngine-layout-primitives 82d59a5267f08b97e4ac46931674e72282650e58`
  - Trong worktree mới: `git status --short`, `git branch --show-current`, `git rev-parse HEAD`
- Kết quả:
  - Chọn baseline dự định merge: `82d59a5267f08b97e4ac46931674e72282650e58`.
  - Tạo branch `agent/layout-primitives`.
  - Tạo worktree `D:\Claude\Projects\SlideshowRenderEngine-layout-primitives`.
  - `git status --short` trong worktree mới không có output: worktree sạch.
  - Plan và tracker chưa có trong worktree mới, đúng phạm vi cần xử lý ở `PRE-0.2`.
- Metric trước/sau: Không áp dụng.
- Commit: Chưa commit.
- Quyết định hoặc sai lệch so với plan:
  - Dùng HEAD đã commit của nhánh hiện tại làm baseline; không mang theo bất kỳ thay đổi chưa commit nào từ worktree cũ.
  - Chưa chạy `npm run check`; đó là gate riêng của `PRE-0.3`.
- Trạng thái kết thúc: `DONE`.
- Blocker còn lại: Không có.
- Bước tiếp theo: `PRE-0.2` — đảm bảo plan và tracker có mặt trong worktree triển khai.

### 2026-07-30 — Khởi tạo tracker

- Session: Codex.
- Đã làm:
  - Đọc `LAYOUT-PRIMITIVES-PLAN.md`.
  - Chia kế hoạch thành các bước có dependency và gate.
  - Tạo file theo dõi này.
- Không sửa code, library hoặc recipe.
- Quan sát:
  - Worktree hiện tại rất bẩn.
  - `LAYOUT-PRIMITIVES-PLAN.md` đang là file untracked tại thời điểm kiểm tra.
  - Branch hiện tại: `agent/refactor-engine-and-add-momo`.
  - HEAD hiện tại: `82d59a5`.
- Bước tiếp theo:
  - Thực hiện `PRE-0.1`: chọn baseline merge và tạo branch/worktree sạch.

## 8. Mẫu ghi nhật ký cho session tiếp theo

Sao chép khối dưới đây và điền giá trị thực:

```markdown
### YYYY-MM-DD HH:mm — <tên bước/batch>

- Session:
- Trạng thái nhận việc: `IN_PROGRESS`
- Phạm vi:
- File đã thay đổi:
- Lệnh đã chạy:
- Kết quả:
- Metric trước/sau:
- Commit:
- Quyết định hoặc sai lệch so với plan:
- Trạng thái kết thúc: `DONE` / `BLOCKED`
- Blocker còn lại:
- Bước tiếp theo:
```
