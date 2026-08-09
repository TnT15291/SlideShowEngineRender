# Tiến độ triển khai Premium Quality Stability

**Kế hoạch nguồn:** `docs/PREMIUM-QUALITY-STABILITY-PLAN.md`
**Bắt đầu:** 2026-08-04
**Trạng thái tổng thể:** P0 hoàn tất và đã kiểm chứng trên job thật; P1 hoàn tất trừ Hướng B (Phase 3); P2 hoãn có lý do đo được

## Quy ước trạng thái

- `[ ]` Chưa bắt đầu
- `[~]` Đang thực hiện
- `[x]` Hoàn tất và đã kiểm chứng
- `[!]` Cố ý không làm — có lý do và số đo kèm theo

## Quyết định sản phẩm đã chốt

**§4.3 — ngữ nghĩa của `effect/set` scope act: phương án (b).** Áp từ đầu scope, dừng khi
chuỗi cảnh cùng effect chạm `MAX_LAYOUT_RUN` (=3). Cảnh vốn đã mang effect đó, nằm liền
trước scope, cũng được tính vào chuỗi — người xem nhìn thấy chuỗi, không nhìn thấy ai viết
ra nó. Order bị cap được audit báo là *làm một phần* kèm lý do, **không** bị tính là gãy.

## Tiến độ theo phase

### Phase 0 — Đóng băng regression và đo diện rộng

- [x] Mốc `test:unit` trước khi sửa: **418 pass / 0 fail**. Không có test nào đang đỏ vì
      lý do khác (mốc trong `unit-test-fixture-gap` đã cũ).
- [x] Quét toàn bộ 49 `projects/*/directives.json` của cả ba tier.
- [x] Fixture `test/fixtures/premium-directive-sweep.mjs` + test `test/premium-directive-accounting.test.mjs`.
- [x] Xác nhận test **đỏ** trên cây chưa sửa, đúng dòng dự đoán:
      `photo demand fell 30 -> 15` và `7 consecutive scenes share one effect (cap 3)`.
- [x] Chốt câu hỏi §4.3.

**Kết quả quét diện rộng — và một đính chính cho §1.3 của kế hoạch:**

| Số đo | Giá trị |
|---|---:|
| Ledger quét | 49 |
| Ledger **rỗng** (job chạy không prompt) | 44 |
| Ledger có bất kỳ order nào | 5 |
| Ledger có `effect/set` | 1 |
| Ledger có `effect/set` non-montage scope `act`/`global` | **1** |

Con số thật là **1/5 ledger có nội dung**, không phải 1/49 — 90% corpus là job không có
prompt nên không nói lên điều gì về tần suất. Job duy nhất trúng là
`layout-primitives-premium-baseline`, và nó mất 15 ảnh. `effect/set` do LLM sinh ra từ
prompt khách đối chiếu toàn bộ vocabulary effect (`parseBrief.mjs`), nên khả năng chạm là
theo từng prompt chứ không theo lịch sử corpus. Corpus mỏng ≠ lỗi hiếm.

### Phase 1 — Hạch toán directive (Hướng A)

- [x] Nhánh non-montage tính `freed` và tái phân bổ cho montage còn room
      (`reallocate()` trong `directiveApplication.mjs`, cùng kỷ luật với surplus pass của
      `recipeShotList.mjs`: tăng một ảnh khai báo mỗi lần rồi đo lại bằng chính `demandOf`
      của caller, vì multiplier pacing khiến 1 ảnh khai báo ≠ 1 ảnh gán).
- [x] Chặn run-length theo phương án (b).
- [x] `options.report` + `analysis/directive-impact.json`. **Kiểu trả về vẫn là `string[]`** —
      `applyStoryTemplate.mjs` `for...of` trên nó và `revisionDiff.mjs` bỏ qua nó.
- [x] Sửa comment `:80-83` — nó đang phát biểu sai ("a sweep ... is safe").
- [x] Duration được tính lại sau mutation.

**Sai khác so với kế hoạch — duration, và tại sao ít code hơn thì đúng hơn.**

§4.2 đề xuất `applyStoryTemplate` tự tính lại duration và đổi điều kiện bỏ qua solver ở
`templateShotList.mjs:70-75` thành `composed && !directivesMutatedScenes`. Không làm vậy, vì
chạy lại `solveRecipeShotList` trên storyboard **đã bị directive sửa** sẽ giải lại toàn bộ
scene plan và xoá luôn thứ directive vừa đặt vào.

Thay vào đó: cảnh nào bị directive đổi hình dạng thì **xoá `durationSec`**. Dòng
`applyStoryTemplate.mjs:772` đã sẵn có hợp đồng *"a composed storyboard has already solved
the durations — a hand-written recipe has not, and keeps the role-based table below"*. Một
cảnh vừa bị ghi đè thì đúng là không còn "solved" nữa, nên nó rơi về bảng duration của
recipe — **mô hình duration duy nhất đã tồn tại, không thêm mô hình thứ hai** (đúng tinh
thần §2.2.6 của kế hoạch Lite). `retimeSlidesToMusic` vốn coi duration là *shape*, không
phải *schedule*, và chuẩn hoá lại toàn phim về `music.duration`, nên drift không đổi.

`templateShotList.mjs:70-75` do đó **không đổi**; chỉ `fit.photosUsed`/`photosLeftOver` được
đo lại từ scene thực có (xem Phase 2).

**Kiểm chứng trên `projects/layout-primitives-premium-baseline`** (storyboard dựng lại trên
cây hiện tại, không đo artifact cũ — đúng quy tắc §0.2):

| Chỉ số | Trước sửa | Sau sửa | Không directives |
|---|---:|---:|---:|
| Ảnh unique / selected | 66 / 82 | **81 / 82** | 81 / 82 |
| `selectedNotRendered` | 16 | **1** | 1 |
| Chuỗi cùng `visualSignature` dài nhất | 7 cảnh / 47,0s | **3 cảnh / 15,0s** | 1 |
| s02 / s04 giữ 8,96s của montage | có | **không (5,0s)** | — |
| Visual family | — | **11** | 11 |
| Net duration vs `musicEdit.duration` | — | **188,830s / 188,83s** | 188,830s |
| `photoLost` | không ai đếm | **0** | — |

- [x] Fixture Phase 0 chuyển xanh (9/9).
- [x] `directives.test.mjs`, `directive-moment.test.mjs`, `revision-preview.test.mjs` xanh.
- [x] Regression Template/Premium (`tier1-quality`, `tier1-album-regression`) xanh.

### Phase 2 — Coverage thành rule có tên

- [x] `photo_coverage` vào `lib/rules/contract.mjs`.
- [x] Policy: `BLOCK` cho Lite, `manual-review` cho Premium/Template.
- [x] Emitter trong `qaProxy.mjs`, đọc `photo-assignment.json`.
- [x] `WARNING` cho `selectedNotRendered` ở stdout (trước chỉ warn khi `assignedNotRendered`).
- [x] `fit.photosUsed` và log build là số đã ship.
- [x] Mọi ảnh bỏ lại quy được về một lý do (`notRenderedReasons`).
- [!] **`layout_repetition` giữ nguyên `WARN`** — xem phần "Cố ý không làm" bên dưới.

Hai flag, cả hai đều chứng minh được, không đoán:

- `directive_photo_loss` — chính xác tuyệt đối: lớp directive tự khai báo cái nó giải phóng
  mà không đặt được. Không cần ngưỡng, bắt được cả job mất 3 ảnh trên 90.
- `coverage_below_floor` — lưới đỡ cho mọi nguyên nhân khác, `PHOTO_COVERAGE_FLOOR = 0.85`.

**Về ngưỡng 0.85 — nói thẳng là bằng chứng mỏng.** Chỉ còn **2** job trong `projects/` giữ
được `photo-assignment.json` (100% và 98,8%), và run hỏng là 80,5%. 0.85 nằm rõ dưới hai job
lành và trên run hỏng. Ghi chú này nằm ngay trong `thresholds.mjs`: đo lại khi có corpus
report thật, đừng coi là đã chốt.

`notRenderedReasons` là **đếm theo nhóm**, không gán lý do cho từng file — pipeline chứng
minh được "3 ảnh mất vì directive", không chứng minh được "ảnh IMG_204 mất vì directive".
Một con số đoán trong biên nhận còn tệ hơn một con số có phạm vi nói rõ.

### Phase 3 — Áp directive trước khi solve (Hướng B)

- [!] **Chưa làm.** Xem phần "Cố ý không làm".

### Phase 4 — Provenance và cân bằng cổng

- [x] `metadata` đầy đủ cho timeline Premium: `pipelineVersion`, `qualityPolicyVersion`,
      `strictText`, `photoCoverage`, `musicSync`, `directiveImpact`.
- [x] `strictLiteText` bỏ so chuỗi `"lite-v2"`, đọc `metadata.strictText` do builder giải
      từ policy row `text_safe_area` của tier.
- [x] Nâng policy Premium: `must_use_coverage`, `caption_integrity`, `text_safe_area`,
      `audio_drift`, `black_frame` → `BLOCK` (chặn **trước** encode).
- [x] `audit()` phân biệt *applied* với *applied with cost*; `formatReport` in dấu `~` và
      dòng lý do bằng tiếng Việt.

`--tier` là cờ tường minh của `applyStoryTemplate` (`runProject`/`renderWithRetry` truyền
`premium`, `generateProjectTimeline` truyền `lite`), có validate theo `TIERS`. Suy tier từ
hình dạng storyboard chính là cách cổng caption trước đây bị khoá vào một chuỗi ký tự.

**Đo trước khi siết caption gate:** 18/49 timeline đang lưu có finding sẽ thành error. Nhưng
cả 18 đều có trước khi `fitTextInTimeline` được nối vào chuỗi build — timeline premium dựng
mới, sau khi fitter chạy, đạt **0 finding**. Template giữ nguyên mức cũ vì chưa có bằng
chứng build-mới tương đương.

**Một lỗi mới lộ ra khi kiểm chứng, đã sửa.** Sau khi có run cap, `auditOne` đọc timeline
thành phẩm thấy *"still on 3/7 photo slides in act opening"* và chấm order `r0.1` là **gãy**.
Vì `strength: "must"`, `report.pass` thành `false` → cổng compliance đánh hỏng cả job. Run
cap là **ta** quyết định không hiểu order theo nghĩa đen, không phải phim bất tuân. Biên nhận
`directive-impact.json` nêu đích danh cảnh nào bị ghi lại và cap là lý do dừng — bằng chứng
mạnh hơn heuristic đọc timeline — nên order được báo là *đã thực hiện, có giá phải trả*:

```
9 yêu cầu · 4 đã thực hiện · 3 không làm được · 1 làm một phần · 2 không kiểm chứng được
  ~ "mở đầu tĩnh"
      → still on 3/7 photo slides in act opening (1 text card(s) exempt)
        — dừng ở 2 cảnh theo giới hạn chuỗi cảnh giống nhau
      · áp cho 2 cảnh rồi dừng để không tạo chuỗi cảnh giống hệt nhau
```

Không có biên nhận thì audit **không** tự nâng cấp gì cả — nguyên tắc "không báo thắng khi
không chứng minh được" giữ nguyên, và có test khoá điều đó.

## Cố ý không làm — kèm số đo

### `layout_repetition` giữ `WARN` (Phase 2)

Đo trên 49 timeline đang lưu: **43** có chuỗi `effect:layout` dài hơn 3. Nâng rule này thành
finding chặn sẽ đánh hỏng 88% corpus — đúng cái rủi ro "ngưỡng quá chặt → nhiều job block"
mà §7 của kế hoạch cảnh báo. Điều kiện "còn cảnh thay thế" trong §4.2 là thứ làm nó an toàn,
nhưng chưa có bằng chứng nào cho thấy nó kéo 43 xuống một con số nhỏ.

Quan trọng hơn: nguyên nhân sinh ra kế hoạch này — chuỗi do directive tạo ra — nay **bị chặn
tại nguồn**, không còn phải trông vào cổng để bắt. Đề nghị mở lại sau khi corpus được dựng
lại trên pipeline mới.

### `--strict` cho `composeStoryboard` (P2)

`renderWithRetry.mjs:314` bắt mọi lỗi ở bước generate rồi `process.exit(1)` **ngay**, không
rơi xuống lite fallback (fallback chỉ chạy khi *render* hỏng). Truyền `--strict` sẽ biến một
album ít ảnh từ "phim chạy chậm nhưng giao được" thành "job chết, không lối thoát". Muốn làm
đúng thì phải sửa xử lý lỗi của `renderWithRetry` trước — việc kế hoạch không yêu cầu.

### Hướng B — áp directive trước khi solve (Phase 3)

Hướng A đã đóng toàn bộ lỗ hổng P0 và vượt acceptance §6.4. Hướng B là refactor kiến trúc
đụng vào `composeStoryboard`, mà `composeStoryboard` **dùng chung với Lite** (§7 nêu đúng rủi
ro này) và với cả nhánh fallback của `renderWithRetry`. Kế hoạch cũng xếp nó P1 và đặt sau
khi A ổn định. Chưa làm, và **logic tái phân bổ của Phase 1 vẫn còn nguyên** — theo §4.1 thì
A chỉ được rút đi *sau khi* B ổn định, nên hiện tại không tồn tại hai mô hình song song.

## Kiểm chứng

| Bộ | Trước | Sau |
|---|---:|---:|
| `test:unit` | 418 / 0 fail | **432 / 0 fail** (+14 test mới) |
| `test:api` | — | **124 / 0 fail** |
| `npx tsc --noEmit` | — | **sạch** |

Test mới: `test/premium-directive-accounting.test.mjs` (9), `test/photo-coverage-rule.test.mjs` (5).

## Definition of Done (§8)

| # | Điều kiện | |
|---|---|:--:|
| 1 | Không directive nào giảm photo demand mà không tái phân bổ hoặc ghi lý do | ✅ |
| 2 | Không directive nào tạo chuỗi vượt `MAX_LAYOUT_RUN` | ✅ |
| 3 | Duration tính lại sau mọi mutation; drift ≤ 0,1s (đo: 0,000s) | ✅ |
| 4 | `photo_coverage` là rule có tên, có policy theo tier, có test | ✅ |
| 5 | `fit.photosUsed` và log build là số đã ship | ✅ |
| 6 | `analysis/directive-impact.json` tồn tại cho mọi job có order | ✅ |
| 7 | Timeline Premium có `pipelineVersion` và `qualityPolicyVersion` | ✅ |
| 8 | Độ nghiêm text gate đến từ policy theo tier, không từ so chuỗi | ✅ |
| 9 | Regression baseline vượt toàn bộ acceptance §6.4 | ✅ |
| 10 | `audit()` phân biệt *applied* với *applied with cost* | ✅ |
| 11 | `test:unit` không đỏ thêm so với mốc Phase 0 | ✅ |

## 2026-08-09 — Floor áp theo số ảnh, không theo tỉ lệ

`npm run test:integration` đỏ ở `PRE-RENDER GATE FAILED: project[coverage_below_floor]`. Không
phải lỗi mới của pipeline: **rule này có độ phân giải thô hơn thứ nó đo trên album nhỏ.**

Test integration dựng 4 ảnh trên track 18s. `composeStoryboard` giải đúng 3 scene, ảnh thứ 4
rơi với lý do khai báo `budget_exceeded`. Coverage 75% < 0,85 → Lite map `photo_coverage` →
`BLOCK` → chặn trước encode. Nhưng 15% của 4 ảnh là **0,6** — hạn mức làm tròn xuống **0**, tức
rule đòi album 4 ảnh fit hoàn hảo trong khi cho album 82 ảnh rơi tới 12 tấm.

Đã cân nhắc và **bác bỏ** phương án miễn trừ `budget_exceeded`: job hỏng khai sinh ra rule này
(66/82) mang đúng lý do đó, và `test/photo-coverage-rule.test.mjs:85` khoá nó. Miễn trừ theo lý
do sẽ mở lại chính lỗ hổng rule được viết để bịt.

Sửa: floor áp bằng **hạn mức số ảnh**, tối thiểu một tấm —
`allowance = max(1, floor(selected × (1 − FLOOR)))`, cờ bật khi `notRendered > allowance`.

Vì `notRendered` là số nguyên, `notRendered > floor(0,15·selected)` **tương đương hoàn toàn**
`ratio < 0,85` với mọi album từ **7 ảnh** trở lên (chỗ `floor(0,15·selected)` chạm 1). Nên hành
vi trên toàn bộ corpus thật không đổi một ca nào; chỉ album ≤6 ảnh đổi, và chỉ đổi đúng một tấm.
Ba ca đang khoá giữ nguyên kết quả: 66/82 đỏ (16 > 12), 81/82 xanh (1 ≤ 12), 87/90 vẫn bắt bằng
cờ `directive_photo_loss` riêng.

`test:unit` **520 / 0 fail** (+3), `test:api` 139/139, `test:integration` **1/1** (từ 0/1),
typecheck 5/5, `audit:prod` 0 lỗ hổng sau `npm audit fix` (4 transitive bump, không dep trực
tiếp nào đổi).

Test mới khoá cả hạn mức lẫn biên của nó: album nhỏ được rơi một tấm, không được rơi hai, và
mốc 7 ảnh cho cùng kết quả với cách đọc bằng tỉ lệ.

## Còn nợ

1. Hướng B (Phase 3), và rút logic tái phân bổ của Phase 1 sau khi B ổn định.
2. Đo lại `PHOTO_COVERAGE_FLOOR` khi có corpus `photo-assignment.json` thật. Hạn mức tối thiểu
   một ảnh (08-09) là sửa **độ phân giải**, không phải sửa con số 0,85 — bằng chứng cho 0,85
   vẫn mỏng đúng như đã ghi.
3. Mở lại `layout_repetition` sau khi corpus được dựng lại.
4. `--strict` cho `composeStoryboard`, sau khi `renderWithRetry` biết fallback trên lỗi generate.
5. Contact-sheet regression cho Premium; canary so v-cũ/v-mới bằng `directive-impact.json` (P2).
