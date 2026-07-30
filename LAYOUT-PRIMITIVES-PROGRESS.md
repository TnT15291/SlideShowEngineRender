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
| Pha hiện tại | `Pha 1 — thêm 7 primitive active` |
| Bước đang thực hiện | Không có |
| Bước hoàn thành gần nhất | `PRE-0.6` — baseline metric V2 đã chốt; **Pha 0 đóng hoàn toàn và đã commit** |
| Bước tiếp theo | `P1.1` — thêm frame preset `circleMedallion` |
| Blocker hiện tại | Không có |
| Branch lúc tạo tracker | `agent/refactor-engine-and-add-momo` |
| Commit lúc tạo tracker | `82d59a5` |
| Commit Pha 0 | `d5e8d0f` baseline snapshot → `b83d601` Pha 0 → `e43dad3` refactor |
| Cập nhật lần cuối | `2026-07-30 19:40 +07:00 — PRE-0.6 DONE, Pha 0 đã commit` |

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
| `catalog.distinct` | 49 | Có — P0A.5: 49 |
| `authored.distinct` | 48 | Có — P0A.5: 48 |
| `authored.shared` | 30 | Có — P0A.5: 30 |
| `reachable.maxShare` | 23 | Có — P0A.5: 23 |
| `reachable.over12Count` | 7 | Có — P0A.5: 7 |
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
| P1.1 | TODO | Thêm frame preset `circleMedallion` | Radius 260 cho slot 520x520 |
| P1.2 | TODO | Append 7 primitive vào cuối mảng `layouts` | Tổng 32 layout; không xáo thứ tự cũ |
| P1.3 | TODO | Validate library bằng G1–G8 | 0 error; G1–G3 và G6–G8 sạch; **không có offender G4 mới** (3 G4 cũ được grandfather, xem ghi chú dưới); G5 chỉ warning |
| P1.4 | TODO | Chạy targeted tests | Tất cả xanh |
| P1.5 | TODO | Nâng ratchet `catalog.distinct` | `>=56`; authored vẫn `>=48` |
| P1.6 | TODO | Dựng timeline probe 7 scene | Mỗi primitive xuất hiện đúng một lần |
| P1.7 | TODO | Xoá scene cache và render probe | Ghi output và kết quả review bằng mắt |
| P1.8 | TODO | Chạy Premium dry-run sau thay đổi | Lưu `temp/premium-after.txt` |
| P1.9 | TODO | So sánh Premium trước/sau | Không đổi scene/photo demand; không có card 4/5 |

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
| P2A.1 | TODO | Tạo adoption map machine-readable | Recipe → scene/look → primitive → override |
| P2A.2 | TODO | Tạo `scripts/adoptNewPrimitives.mjs` | Theo khuôn `diversifyRecipeLooks.mjs` |
| P2A.3 | TODO | Cài `--check-plan` in-memory, không ghi file | Hash/source không đổi sau lệnh |
| P2A.4 | TODO | Report mọi occurrence của 7 key quá rộng | Gồm main/fallback/repeat variant |
| P2A.5 | TODO | Kiểm photo demand và union text key | Không mất ảnh hoặc copy |
| P2A.6 | TODO | Kiểm gallery-tail toàn cục | Mỗi recipe có chuỗi duy nhất |
| P2A.7 | TODO | Kiểm mỗi primitive có >=2 host | Không có entry Pha 1b |
| P2A.8 | TODO | Mô phỏng đồng thời sáu recipe chỉ có 3 ứng viên | Không xung đột gallery-tail |

### Pha 2B — Pilot ba recipe

| Recipe | Trạng thái | Yêu cầu |
|---|---|---|
| `cinematic-film-01` | TODO | 3 scene meaningful; gồm `offset_portrait_hero` |
| `jmii-silk-botanical-01` | TODO | 3 scene meaningful; frame tròn đúng radius nếu resize |
| `editorial-bold-01` | TODO | 3 scene meaningful; không dùng `s03_chapter` sai text contract |

Sau pilot:

- Chạy lại `--check-plan` trên toàn bộ adoption map.
- Nâng ratchet đúng ba recipe đã migrate.
- Chỉ hạ `maxShare/over12Count` tới số đo thực tế.
- Commit pilot độc lập.

### Pha 2C — Rollout theo batch

| Batch | Recipe | Trạng thái | Commit |
|---|---|---|---|
| B1 | `afterparty-pulse-01`, `cinematic-vows-01`, `city-to-ceremony-01`, `classic-luxury-01` | TODO | — |
| B2 | `classic-multisong-album-01`, `family-roots-01`, `four-seasons-love-01`, `garden-botanical-01` | TODO | — |
| B3 | `garden-diary-01`, `heritage-ceremony-01`, `korean-soft-01`, `letters-to-forever-01` | TODO | — |
| B4 | `long-distance-love-01`, `luminous-editorial-motion-01`, `modern-teal-01`, `playful-scrapbook-01` | TODO | — |
| B5 | `studio-white-prewedding-01`, `three-chapters-biography-01`, `warm-film-01`, `white-weddings-editorial-01` | TODO | — |

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
| `white-weddings-full-01` | TODO | Không nhận primitive mới; giữ ratchet meaningful `>=1` |

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
| Pha 1 primitives | — | — | — | TODO |
| Pha 1 visual probe | — | — | `temp/probe-primitives.json` | TODO |
| Pha 1 Premium comparison | — | Before: 38 scene, 82/82 ảnh, 188.83s, không card 4/5 | `temp/premium-before.txt` SHA-256 `3549F96C...DBD883`; after chưa có | IN_PROGRESS |
| Pha 2 adoption planner | — | — | adoption map/report | TODO |
| Pha 2 pilot | — | — | — | TODO |
| Pha 2 batch B1 | — | — | — | TODO |
| Pha 2 batch B2 | — | — | — | TODO |
| Pha 2 batch B3 | — | — | — | TODO |
| Pha 2 batch B4 | — | — | — | TODO |
| Pha 2 batch B5 | — | — | — | TODO |
| Nghiệm thu cuối | — | — | — | TODO |
| Pha 3 tuỳ chọn | — | — | — | TODO |

## 7. Nhật ký bàn giao

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
