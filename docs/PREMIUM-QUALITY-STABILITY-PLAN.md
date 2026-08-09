# Kế hoạch nâng cấp Premium — hạch toán directive, coverage và provenance

**Trạng thái:** Điều tra xong, chưa sửa dòng nào. Audit ngày 2026-08-04
**Phạm vi:** Pipeline `tier=premium` từ directive ledger đến delivery
**Mục tiêu chính:** Lớp directive không được phá kế hoạch mà composer đã giải, và mọi tổn thất nó gây ra phải hiện ra ở một cổng có tên.
**Regression chuẩn đầu tiên:** project `projects/layout-primitives-premium-baseline`
**Tài liệu anh em:** `docs/LITE-QUALITY-STABILITY-PLAN.md` — Premium dùng chung phần lớn code đã được vá ở đó; tài liệu này chỉ nói về phần KHÔNG dùng chung.

---

## 0. Kết luận điều tra

Câu hỏi đặt ra: *"Premium có bị tình trạng tương tự Lite không?"*

Trả lời: **Có, nhưng không phải cùng một lỗi.** Lite v1 hỏng vì có một planner riêng tồi. Premium chạy đúng chuỗi chuẩn và phần planner của nó sạch. Premium hỏng ở **lớp directive** — đúng thứ khách trả tiền để được dùng.

> **Đính chính 2026-08-04 (cùng ngày, sau khi rà lại `runProject`).** Bản đầu của tài liệu này viết lớp directive là "thứ Lite gần như không có". **Sai.** `parseBrief.mjs` chạy cho **mọi tier** (`runProject.mjs:396-400`, ngoài nhánh if/else theo tier), và cả ba tier đều truyền `--directives` vào `applyStoryTemplate` — Lite ở `generateProjectTimeline.mjs`, Template/Premium ở `runProject`/`renderWithRetry`. `projects/tuan-tien-lite/directives.json` tồn tại thật.
>
> Vậy **lỗi §1 là lỗi dùng chung, không riêng Premium.** Điều đúng còn lại là mức độ phơi nhiễm khác nhau:
> - Directive scope `act` khớp tên act của Premium (`opening`, `love_story`, `ceremony`) nên trúng. Storyboard Lite đặt act là `beat_01..beat_08`/`ending`, nên directive scope-act **trượt** — đây là miễn nhiễm tình cờ, không phải thiết kế, và sẽ mất ngay khi ai đó thống nhất tên act.
> - Directive scope `global` trúng **cả ba tier** (`inScope`: `d.scope.global ? !structural(scene, i)`).
> - Prompt của khách Premium giàu order nhất, nên xác suất có `effect/set` cao nhất.
>
> Hệ quả với kế hoạch: các bản vá ở §4.2 vẫn nguyên vẹn, nhưng verify phải chạy trên **cả ba tier**, và bước quét diện rộng ở Phase 0 phải quét `projects/*/directives.json` của mọi tier chứ không chỉ Premium.

### 0.1. Những gì Premium đã đúng

Premium chạy `composeStoryboard → writeRecipeCopy → applyStoryTemplate → fitTextInTimeline`
(`scripts/renderWithRetry.mjs:107-178`) — chính chuỗi mà Phase 1–2 của kế hoạch Lite đã chuyển Lite sang. Mọi bản vá nằm trong code dùng chung, Premium hưởng sẵn:

| Hạng mục | Bằng chứng đo được |
|---|---|
| Common composer + global assignment | `reuses=[]`, `adjacentCollisions=0`, `unfilled=[]` |
| Một allocator duy nhất (§4.4.3 Lite) | net 188,830s vs `musicEdit` 188,83s → **drift 0,000s** |
| Text fitter chung (`captions[]` + `layers[]`) | `adjusted 3, blockers 0`; blocker → `exit 1` → `step()` ném lỗi → build chết |
| Verdict evaluator chung | `deliver.mjs:350` map `director → premium` rồi gọi `evaluateQualityReport` |
| Drift gate ở delivery | `deliver.mjs:68-73` `die()` không phân biệt tier |
| Khối `timeline` trong `photo-assignment.json` | Dùng chung trong `applyStoryTemplate` |

Không có modulo layout, không có photo cursor. Về §2.2.1–2.2.7 của kế hoạch Lite, Premium sạch. **Không cần port Phase 1–5 sang Premium.**

### 0.2. Số đo thật

Job `projects/layout-primitives-premium-baseline`: 82 ảnh selected, track *River Flows In You*, `musicEdit.duration = 188,83s`, 38 scene.

Theo đúng quy tắc §0.2 của kế hoạch Lite (*regenerate rồi mới đo*): artifact trên đĩa sinh lúc 08:51 ngày 08-02, code sửa lần cuối 15:22 cùng ngày — chênh 6 tiếng, nên **không đo artifact cũ**. Toàn bộ số dưới đây lấy từ timeline dựng lại trên cây hiện tại.

Hai lần chạy, chỉ khác **một cờ** `--directives`:

| Chỉ số | Có directives | Không directives | Chênh |
|---|---:|---:|---:|
| Ảnh unique / reference | **66 / 67** | **81 / 82** | −15 |
| `selectedNotRendered` | **16** | 1 | +15 |
| s02 `memory_wall` (6 ảnh) | → `still` (1 ảnh) | giữ nguyên | −5 |
| s04 `photo_strip_up` (6 ảnh) | → `still` (1 ảnh) | giữ nguyên | −5 |
| s07 `collage_grid` (6 ảnh) | → `still` (1 ảnh) | giữ nguyên | −5 |
| Chuỗi `still` liên tiếp dài nhất | **7 cảnh / 47,0 giây** | — | — |
| `maxUses` | 2 | 2 | bookend hero cố ý, không phải lỗi |
| Drift | 0,000s | 0,000s | — |
| **Verdict `qaProxy`** | **`ok`** | `ok` | — |

Thứ đã ship: **s02–s08 là 7 cảnh `still` liên tiếp, 47 giây liền — một phần tư bộ phim 189 giây — hoàn toàn không có chuyển động**, trong đó ba cảnh giữ nguyên độ dài 9 giây vốn được tính cho một montage 6 ảnh. Mười sáu tấm ảnh của khách không bao giờ lên phim.

Và `qaProxy` cho `verdict=ok`, `pacing 0 flagged/31 story scenes`.

### 0.3. Cách tái hiện

```bash
SC=<scratch>/pa
cp -r projects/layout-primitives-premium-baseline/analysis "$SC/analysis"

node scripts/composeStoryboard.mjs \
  --photos projects/layout-primitives-premium-baseline/analysis/photos.selected.json \
  --music "projects/layout-primitives-premium-baseline/music/River Flows In You.mp3" \
  --analysis-dir "$SC/analysis" \
  --plan projects/layout-primitives-premium-baseline/analysis/story_plan.json \
  --director projects/layout-primitives-premium-baseline/analysis/director_notes.json \
  --name lppb --quality share --max-reuse 1 \
  --directives projects/layout-primitives-premium-baseline/directives.json \
  --out "$SC/analysis/storyboard.json"

# chạy applyStoryTemplate HAI lần: một lần có --directives, một lần không.
# So sánh dòng "coverage:" và effect của s02/s04/s07.
```

---

## 1. Lỗi P0 — lớp directive phá kế hoạch đã giải

### 1.1. Chuỗi nhân quả

Ledger của job này có một order rất bình thường:

```json
{ "id": "r0.1", "quote": "mở đầu tĩnh", "kind": "effect", "op": "set",
  "scope": { "act": "opening" }, "target": "still", "strength": "must" }
```

Khách viết *"mở đầu tĩnh"*. Bốn tầng cộng lại biến câu đó thành 47 giây phim chết:

**Tầng 1 — composer không biết order tồn tại.**
`composeStoryboard` có đọc ledger (`composeStoryboard.mjs:109-110`) nhưng `orders` chỉ được truyền vào **đúng một chỗ**: `resolveMusicWindow` (`:118`), tức chỉ để chọn độ dài nhạc. Nó giải scene plan, photo budget và duration **hoàn toàn không biết** khách đã yêu cầu gì về effect. Kế hoạch 81 ảnh / 38 cảnh được giải trong trạng thái mù.

**Tầng 2 — nhánh sweep không hạch toán ngân sách.**
`applyStoryTemplate.mjs:168` gọi `applyToStoryboard` để áp order lên storyboard **đã giải xong**. Nhánh non-montage (`directiveApplication.mjs:126-133`):

```js
if (!isMontage(d.target)) {
  for (const { scene, i } of candidates) {
    scenes[i] = { ...scene, effect: d.target, photoSlots: [{ slot: "hero", count: 1 }] };
    delete scenes[i].layout;
    delete scenes[i].text;
  }
```

Ép `count: 1` lên **mọi** cảnh trong scope. Act `opening` có 7 cảnh, ba trong số đó là montage 6 ảnh → 18 ảnh tụt còn 3.

`demandOf` được định nghĩa ngay phía trên (`:107`) và nhánh montage bên dưới dùng nó cẩn thận để không vượt ngân sách. **Nhánh non-montage không đọc `demandOf` một lần nào.** 15 ảnh được giải phóng chỉ đơn giản là bốc hơi.

**Tầng 3 — giả định sai được viết thành comment.**
`directiveApplication.mjs:80-83`:

> *SINGLE-IMAGE target — asks for a LOOK, so it sweeps every retargetable scene in scope. Honour = "all of them". **A sweep only ever LOWERS photo demand (a 3-photo layout becomes a 1-photo shot), so it is safe.***

"Safe" ở đây đúng theo nghĩa *build không chết* — assignment luôn lấp được ít slot hơn. Nó không đúng theo nghĩa sản phẩm. Đây là chỗ cần sửa nhận thức trước khi sửa code: **hạ demand an toàn cho trình biên dịch, không an toàn cho bộ phim.**

**Tầng 4 — không ai tính lại duration.**
`templateShotList.mjs:70-75`: `template.source.origin === "composed"` khiến solver bị bỏ qua hoàn toàn — đúng, vì storyboard đã giải rồi. Nhưng hợp đồng đó chỉ còn đúng khi storyboard *chưa bị sửa*. Sau khi `applyToStoryboard` đổi `photoSlots`, không ai tính lại `durationSec`. Montage 9 giây trở thành still 9 giây.

### 1.2. Vì sao không cổng nào bắt được

| Cơ chế | Vì sao im lặng |
|---|---|
| `unfilled` | Rỗng — assignment lấp thừa sức 65 slot |
| `assignedNotRendered` | Rỗng — solver không hề phân 15 ảnh đó, nên không có gì "assigned mà không render" |
| `selectedNotRendered` | **Có 16 mục** — nhưng `applyStoryTemplate.mjs:966-970` chỉ gắn `WARNING` khi `assignedNotRendered` khác rỗng |
| `fit.photosUsed` | In ra **81** — con số composer tính *trước* directive. Log nói "81/81 photos" trên phim dùng 66 |
| `qaProxy` pacing | So với chính allocator chạy trên slide hiện tại → nhất trí → 0 flagged |
| `duplicate_photo` | Chỉ kiểm cảnh **liền kề**; không có ảnh nào lặp |
| `must_use_coverage` | Chỉ phủ ảnh khách khoá cứng |
| `layout_repetition` | **Có bắt** — `still:none repeats for more than 3 consecutive scenes` — nhưng là `WARN` ở **cả ba tier**, không bao giờ chặn, không bao giờ repair |
| `auditCompliance` | Báo r0.1 **đã áp dụng**. Biên nhận đúng; nó chỉ không nói order đó tốn 15 tấm ảnh |

Tức là: rule duy nhất nhìn thấy lỗi bị buộc phải im, và metric duy nhất đếm được tổn thất thì không được nối vào cổng nào.

### 1.3. Mức độ tổng quát

Cơ chế này tổng quát: **mọi** `effect/set` có target non-montage và scope `act` hoặc `global` đều đi qua `:126-133`. Scope `global` quét mọi cảnh không structural. *"Mở đầu tĩnh"*, *"cả phim dùng zoom chậm"*, *"đoạn lễ để yên"* đều là câu tiếng Việt hết sức tự nhiên.

Và theo đính chính ở §0.1, nó tổng quát **qua cả ba tier**, không riêng Premium — vì `applyToStoryboard` là code dùng chung và mọi tier đều nạp ledger vào nó.

Cần thừa nhận giới hạn: **tôi mới đo một job.** Độ nghiêm trọng phụ thuộc prompt từng khách. Phase 0 dưới đây có một bước quét toàn bộ `projects/` (mọi tier) để biết con số thật.

---

## 2. Bốn lỗ hổng cấu trúc còn lại

### 2.1. `pipelineVersion` là tài sản riêng của Lite

Chỉ `generateProjectTimeline.mjs:96,125` ghi nó. Quét 40 timeline trong `projects/`: **duy nhất `tuan-tien-lite` có**. Timeline Premium có `metadata: {}` rỗng.

Hệ quả:

- `src/preflightTimeline.ts:282` — `strictLiteText` gate trên đúng chuỗi `"lite-v2"`. Toàn bộ check caption (safe width 86%, ≤3 dòng, vertical box, reading-rate) là **`errors` cho Lite, `warnings` cho Premium**. Không có lý do sản phẩm nào cho việc caption Premium được phép tràn safe width trong khi Lite thì không.
- `qaLoop.mjs:251,295` ghi `pipelineVersion: null` vào `static-gate.json` và `final-verdict.json` → Premium không có provenance (DoD §10 của kế hoạch Lite).
- `resumeProject.mjs:94` — invalidation theo version chỉ hoạt động cho Lite.

Giảm nhẹ: `fitTextInTimeline` đã chặn cứng (exit 1) nên rủi ro caption tràn thấp hơn vẻ ngoài. Nhưng hai đường đo khác nhau cho cùng một thứ vẫn là nợ.

### 2.2. Bảng policy — `POLICY.premium = { ...BASE }`

Toàn bộ phần siết của kế hoạch Lite chỉ vào bảng `LITE` (`policy.mjs:53-66`). Premium có **đúng một** hàng `BLOCK` (`caption_language`); Lite có tám.

Cần nói chính xác để không thổi phồng: vì `runProject.mjs:575` luôn truyền `--strict`, một finding `manual-review` của Premium **vẫn** làm `qaLoop` exit 1 ở cuối, và `deliver` vẫn `die()` khi verdict khác `pass`. **Premium không ship phim hỏng vì lỗ hổng này.**

Vấn đề là *thời điểm*: `qaLoop.mjs:298` chỉ chặn `actions.block` **trước render**. Premium gần như không có hàng `block`, nên nó trả tiền encode xong mới fail. Tier đắt nhất là tier duy nhất không có lá chắn pre-render.

### 2.3. `selectedNotRendered` được tính nhưng không ai nối vào cổng

Xem 1.2. Metric đã có, đã ghi ra file, và là metric **duy nhất** đếm đúng tổn thất — chỉ thiếu một rule có tên.

### 2.4. Không có regression Premium

| Tier | Test |
|---|---|
| Lite | `lite-tier`, `lite-quality-regression`, `lite-text-fit`, `lite-style-profiles` + fixture Tuân Tiên |
| Premium | `premium-playlist.test.mjs` (chỉ playlist), `directives.test.mjs` (unit, không phủ nhánh sweep) |

Không test nào sẽ đỏ nếu lỗi §1 nặng thêm. Ngoài ra `composeStoryboard --strict` — cổng `fit.verdict` — **không script nào truyền**, kể cả Lite.

---

## 3. Quality invariants bắt buộc cho Premium

Bổ sung cho §4 của kế hoạch Lite; chỉ liệt kê phần Premium-specific.

### 3.1. Hạch toán directive

1. Một directive không được làm giảm tổng photo demand mà không **tái phân bổ** số ảnh giải phóng cho các cảnh còn lại.
2. Một directive không được tạo quá `MAX_LAYOUT_RUN` cảnh liên tiếp cùng `visualSignature`.
3. Sau khi directive sửa `photoSlots`, duration phải được phân bổ lại; tổng net duration giữ nguyên `musicEdit.duration ± 0,1s`.
4. Mọi thay đổi do directive gây ra phải để lại vết đo được: số cảnh bị ghi đè, delta photo demand, số ảnh tái phân bổ, số ảnh mất hẳn.
5. `fit.photosUsed` trong artifact và trong log phải là số **đã ship**, không phải số trước directive.
6. Một order không thể honour trọn vẹn phải được audit báo là *áp dụng một phần* kèm lý do, không báo là *đã áp dụng*.

### 3.2. Photo coverage

7. Tỷ lệ `usedUnique / selected` không được thấp hơn ngưỡng coverage của job mà không có lý do ghi trong metadata.
8. Mọi ảnh trong `selectedNotRendered` phải quy được về một lý do: `budget_exceeded`, `directive_reduced_demand`, `quality_floor`, `orientation_unfillable`.

### 3.3. Provenance

9. Timeline Premium mang `pipelineVersion`, `qualityPolicyVersion`, `photoCoverage`, `musicSync` trong `metadata`.
10. Độ nghiêm của text gate là quyết định **policy theo tier**, không phải so chuỗi `pipelineVersion`.

---

## 4. Thiết kế sửa

### 4.1. Quyết định kiến trúc

Có hai hướng, và tôi đề xuất **hướng B**, có kèm hướng A như bước đệm.

**Hướng A — vá tại chỗ nhánh sweep.** Cho `applyToStoryboard` tự hạch toán: tính `freed`, tái phân bổ, chặn run-length. Rẻ, ít rủi ro, sửa được ngay. Nhưng vẫn để nguyên nghịch lý gốc: một module đang sửa kế hoạch mà module khác đã giải xong, bằng logic tái phân bổ *thứ hai* — đúng cái pattern "hai mô hình cạnh tranh" mà §2.2.6 của kế hoạch Lite tồn tại để diệt.

**Hướng B — áp directive TRƯỚC khi solve.** Cho `composeStoryboard` áp `effect/set` (và các order ảnh hưởng hình dạng cảnh) vào scene plan **trước** khi tính photo budget và duration. Composer vốn đã đọc ledger; nó chỉ đang dùng cho mỗi music window. Khi đó ngân sách, duration và effect nhất quán *do cấu tạo*, không do ba chỗ đồng ý với nhau nhờ may mắn — đúng nguyên tắc §5.4 của kế hoạch Lite ("composer sở hữu scene shape").

Đề xuất: làm A ở Phase 1 để chặn máu, làm B ở Phase 3 và rút A đi. Không giữ cả hai lâu dài.

### 4.2. Thay đổi theo file

| File/module | Thay đổi | Mức |
|---|---|---:|
| `scripts/lib/directiveApplication.mjs` | Nhánh non-montage (`:126-133`) tính `freed = Σ(demandOf(before) − demandOf(after))`, tái phân bổ cho variable scene còn lại (dùng lại logic surplus `recipeShotList.mjs:404-425`), chặn run-length theo `MAX_LAYOUT_RUN`. Sửa comment `:80-83` — nó đang phát biểu sai. | P0 |
| `scripts/lib/directiveApplication.mjs` | `applyToStoryboard` nhận thêm `options.report` (object mutable) và điền `{ scenesRewritten, photoFreed, photoReallocated, photoLost, runsCapped }`. **Giữ nguyên kiểu trả về `string[]`** — `applyStoryTemplate.mjs:168` đang `for...of` trên nó và `revisionDiff.mjs:111,113` bỏ qua nó; đổi kiểu trả về sẽ vỡ cả hai. | P0 |
| `scripts/applyStoryTemplate.mjs` | Nhận `report` từ trên; nếu `photoFreed > 0` thì tính lại duration thay vì tin `origin:"composed"`; ghi report vào `analysis/directive-impact.json`; `WARNING` khi `selectedNotRendered` khác rỗng (`:966-970`) | P0 |
| `scripts/lib/templateShotList.mjs` | Điều kiện bỏ qua solver đổi từ `composed` thành `composed && !directivesMutatedScenes` (`:70-75`) | P0 |
| `scripts/lib/rules/contract.mjs` | Thêm `photo_coverage: { scope: "timeline", repairs: [] }` | P0 |
| `scripts/lib/rules/policy.mjs` | `photo_coverage`: `BLOCK` cho Lite, `manual-review` cho Premium/Template. Nâng `must_use_coverage`, `caption_integrity`, `audio_drift` của Premium lên `BLOCK` để chặn **trước** render | P1 |
| `scripts/qaProxy.mjs` | Emit `photo_coverage` từ `photo-assignment.json`; nâng `layout_repetition` thành finding thật khi run vượt cap và còn cảnh thay thế | P0/P1 |
| `scripts/composeStoryboard.mjs` | (Hướng B) áp `effect/set` vào scene plan trước khi solve; ghi `pipelineVersion: "premium-v1"` | P1 |
| `src/preflightTimeline.ts` | `strictLiteText` (`:282`) đổi thành cờ theo tier/policy, bỏ so chuỗi `"lite-v2"` | P1 |
| `scripts/lib/directiveAudit.mjs` | `audit()` phân biệt *applied* với *applied with cost*; một order làm mất ảnh phải hiện ra trong biên nhận | P1 |
| `scripts/renderWithRetry.mjs` | Truyền `--strict` cho `composeStoryboard` | P2 |
| Regression test Premium directive (mới, trong `test/`) | Xem §6 | P0 |

### 4.3. Điểm cần chốt trước khi code

**Ngữ nghĩa của `effect/set` scope act.** *"Mở đầu tĩnh"* nghĩa là gì?

- (a) Cảnh mở đầu tĩnh — áp cho cảnh đầu của act.
- (b) Act mở đầu *có cảm giác* tĩnh — áp cho cảnh đầu rồi giảm dần, giới hạn bởi `MAX_LAYOUT_RUN`.
- (c) Mọi cảnh trong act đều tĩnh — hành vi hiện tại.

Tôi đề xuất **(b)**: giữ được ý khách, không tạo 47 giây phim chết, và có ngưỡng đo được. Nhưng đây là quyết định sản phẩm, không phải kỹ thuật — cần chốt trước Phase 1, vì nó quyết định test viết thế nào.

---

## 5. Kế hoạch theo phase

### Phase 0 — Đóng băng regression và đo diện rộng

**Công việc**
- Ghi lại số `npm run test:unit` **trước** khi bắt đầu, kèm danh sách test đang đỏ vì lý do khác. Repo này thường có nhiều session sửa song song.
- Quét toàn bộ `projects/*/directives.json` **của cả ba tier**: đếm bao nhiêu job có `effect/set` non-montage scope `act`/`global`, và với mỗi job đó, dựng lại timeline hai lần (có/không directives) để đo delta coverage. Đây là con số quyết định mức độ ưu tiên thật.
- Tạo fixture regression Premium directive trong `test/fixtures/`: storyboard đã compose (~12 cảnh, có ≥2 montage trong một act) + ledger có một `effect/set` scope act target `still`. Không cần ảnh thật.
- Chốt câu hỏi ngữ nghĩa ở §4.3.

**Verify**
- Test mới **đỏ** trên cây hiện tại, đúng dòng "directive reduced photo demand without reallocating".
- Báo cáo quét nêu rõ: bao nhiêu job đã bị ảnh hưởng, mất trung bình bao nhiêu ảnh.

### Phase 1 — Hạch toán directive (Hướng A)

**Công việc**
- `freed`/tái phân bổ trong nhánh non-montage.
- Chặn run-length theo quyết định §4.3.
- `options.report` + `analysis/directive-impact.json`.
- Tính lại duration khi `photoFreed > 0`.

**Verify**
- Fixture Phase 0 chuyển xanh.
- Trên `layout-primitives-premium-baseline`: coverage ≥ 78/82, không chuỗi `still` nào vượt `MAX_LAYOUT_RUN`, drift vẫn ≤ 0,1s.
- `test:unit` không đỏ thêm. Đặc biệt `directives.test.mjs`, `directive-moment.test.mjs`, `revision-preview.test.mjs` — `revisionDiff` gọi chung `applyToStoryboard`.
- Regression Template/Premium (`tier1-quality`, `tier1-album-regression`) vẫn xanh: `applyToStoryboard` là code dùng chung.

### Phase 2 — Coverage thành rule có tên

**Công việc**
- `photo_coverage` vào contract + policy + emitter trong `qaProxy`.
- `WARNING` cho `selectedNotRendered`.
- `fit.photosUsed` in số đã ship.
- `layout_repetition` nâng mức.

**Verify**
- Cố tình tiêm một ledger phá coverage → `qaProxy` ra finding `photo_coverage`, `qaLoop` chặn đúng theo tier.
- Cùng report cho cùng verdict ở QA và delivery.
- Ngưỡng coverage không làm đỏ regression Template hiện có.

### Phase 3 — Áp directive trước khi solve (Hướng B)

**Công việc**
- Chuyển `effect/set` (và các order đổi hình dạng cảnh) vào `composeStoryboard`, trước khi tính budget/duration.
- Rút logic tái phân bổ của Phase 1 khỏi `directiveApplication` sau khi B ổn định.
- `pipelineVersion: "premium-v1"`.

**Verify**
- `directive-impact.json` báo `photoLost: 0` trên corpus canary.
- Không còn đường nào sửa `photoSlots` sau khi solver đã chạy.
- `composed` lại là hợp đồng đúng vô điều kiện.

### Phase 4 — Provenance và cân bằng cổng

**Công việc**
- `metadata` đầy đủ cho timeline Premium.
- `strictLiteText` → cờ theo tier.
- Nâng các hàng policy ở §4.2.
- `audit()` phân biệt *applied with cost*.

**Verify**
- `static-gate.json`/`final-verdict.json` của Premium có `pipelineVersion` khác `null`.
- Caption Premium chịu đúng ngưỡng như Lite.
- Job có blocker fail **trước** encode, không phải sau.

---

## 6. Test matrix bắt buộc

### 6.1. Directive
- `effect/set` non-montage scope `act` lên act có ≥2 montage → coverage không tụt, run không vượt cap.
- Cùng thế nhưng scope `global`.
- `effect/set` montage target → hành vi absorb cũ **không đổi** (đây là hồi quy dễ gây nhất).
- Ledger rỗng → output byte-identical với trước khi sửa.
- Album ít ảnh: `freed` không đủ tái phân bổ → phải báo lý do, không im lặng.
- Directive mâu thuẫn nhau (hai `effect/set` chồng scope).

### 6.2. Coverage
- Coverage dưới ngưỡng → `photo_coverage` block/manual-review đúng tier.
- `selectedNotRendered` khác rỗng → có WARNING ở stdout.
- Mọi ảnh bỏ lại quy được về một lý do trong enum.

### 6.3. Provenance
- Timeline Premium có `pipelineVersion`, `qualityPolicyVersion`.
- Caption Premium vượt safe width → error, không phải warning.

### 6.4. Regression `layout-primitives-premium-baseline`

Acceptance riêng:
- Coverage ≥ 78/82 ảnh unique.
- Không chuỗi nào vượt 3 cảnh cùng `visualSignature`.
- Không cảnh single-photo nào giữ duration được tính cho montage.
- Tối thiểu 6 visual family.
- Net duration khớp `musicEdit.duration ± 0,1s`.
- `directive-impact.json` tồn tại và `photoLost` có lý do.
- QA và delivery cùng verdict.

---

## 7. Rủi ro

| Rủi ro | Tác động | Giảm thiểu |
|---|---|---|
| Sửa `applyToStoryboard` làm hồi quy Template | `revisionDiff` và tier-1 dùng chung | Giữ nguyên kiểu trả về; chạy full `test:unit`, không chỉ test Premium |
| Tái phân bổ tạo montage quá dày | Phim rối, ngược ý khách | Chỉ tái phân bổ cho variable scene, tôn trọng `VARIABLE_MAX`, không vượt `MAX_SLIDE_SEC` |
| Chặn run-length làm khách thấy order bị "phớt lờ" | Mất lòng tin | `audit()` báo *áp dụng một phần* kèm lý do, không im lặng |
| Ngưỡng coverage quá chặt | Nhiều job block | Đo trên corpus `projects/` trước khi khoá số — đúng bài học `MAX_TRANSITION_RATIO` của kế hoạch Lite |
| Hướng B đổi hành vi composer | Ảnh hưởng cả Lite (dùng chung composer) | Áp directive sau một cờ; Lite bật sau khi Premium ổn định |
| Verify bằng artifact cũ | Kết luận sai | Regenerate rồi mới đo — chính bẫy đã bắt bản audit đầu của kế hoạch Lite. `temp/scene-cache/` cũng không tự invalidate |
| Đo trên một job | Ước lượng sai mức độ | Phase 0 quét toàn bộ `projects/` trước khi xếp ưu tiên |

---

## 8. Definition of Done

1. Không directive nào giảm photo demand mà không tái phân bổ hoặc ghi lý do.
2. Không directive nào tạo chuỗi cảnh giống nhau vượt `MAX_LAYOUT_RUN`.
3. Duration được tính lại sau mọi mutation của directive; drift ≤ 0,1s.
4. `photo_coverage` là rule có tên, có policy theo tier, có test.
5. `fit.photosUsed` và log build là số đã ship.
6. `analysis/directive-impact.json` tồn tại cho mọi job Premium.
7. Timeline Premium có `pipelineVersion` và `qualityPolicyVersion`.
8. Độ nghiêm của text gate đến từ policy theo tier, không từ so chuỗi.
9. Regression `layout-primitives-premium-baseline` vượt toàn bộ acceptance §6.4.
10. `audit()` phân biệt được *applied* với *applied with cost*.
11. `test:unit` không đỏ thêm so với mốc Phase 0.

---

## 9. Thứ tự ưu tiên

### P0 — Ngăn phim mất ảnh được giao
1. Quét diện rộng + fixture đỏ (Phase 0).
2. Hạch toán `freed` + chặn run-length (Phase 1).
3. Tính lại duration sau mutation.
4. `photo_coverage` + WARNING cho `selectedNotRendered` (Phase 2).

### P1 — Cân bằng cổng và provenance
1. Áp directive trước khi solve (Phase 3).
2. `pipelineVersion` cho Premium; tách text gate khỏi so chuỗi.
3. Nâng các hàng policy Premium để chặn pre-render.
4. `audit()` báo *applied with cost*.

### P2 — Vận hành
1. `--strict` cho `composeStoryboard`.
2. Contact-sheet regression cho Premium.
3. Canary so v-cũ/v-mới bằng `directive-impact.json`.

---

## 10. Một câu hỏi sản phẩm đã có dữ liệu để trả lời

§12 của kế hoạch Lite để ngỏ: *"sau Phase 1–2, khác biệt còn lại giữa hai tier chỉ là ai viết copy và độ sâu QA."*

Đo xong thì câu trả lời là: **khác biệt lớn nhất hiện nay là Premium có lớp directive, và lớp đó là bộ phận duy nhất trong pipeline được phép ghi đè kế hoạch đã giải mà không phải hạch toán lại.** Nó cũng chính là thứ khách trả tiền để có.

Điều đó lật ngược giả định định giá ngầm trong kế hoạch Lite. Lớp directive cần **nhiều** invariant hơn Lite, không phải ít hơn — vì nó là lớp duy nhất mà một câu tiếng Việt bình thường của khách có thể, một cách hợp lệ, xoá 15 tấm ảnh khỏi bộ phim của chính họ.
