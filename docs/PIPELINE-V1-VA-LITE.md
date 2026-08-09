# Pipeline sản xuất video cưới — Template, Lite v2, Premium v1

**Bản viết lại 2026-08-04 — mô tả pipeline NHƯ CODE ĐANG CHẠY, không phải như thiết kế ban đầu.**

Bản trước của tài liệu này là văn bản thiết kế thời lập kế hoạch: nó mô tả một pipeline mà AI sinh thẳng `timeline.json` rồi được sửa qua vòng retry, và một Lite chạy bằng bảng tra cứu if/else. **Cả hai đều không còn đúng.** Xem §8 để biết chính xác những gì đã đổi và vì sao — phần đó giữ lại để người đọc bản cũ không kết luận sai.

Ba tier, một orchestrator, một render engine:

| Tier | Lệnh | AI calls | Ai viết lời |
|---|---|---:|---|
| **Template** | `npm run template -- --project <p>` | 0 (vi) / 1 (en) | Recipe đã soạn sẵn |
| **Lite v2** | `npm run lite -- --project <p>` | 1 (story) | AI viết story, adapter rút gọn |
| **Premium v1** | `npm run premium -- --project <p>` | 4–6 | AI đạo diễn + AI copywriter |

> **Nền tảng chung:** cả ba tier xuất ra `timeline.json` rồi đưa qua **cùng một render engine**.
> Xem [ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md), [NANG-LUC-ENGINE.md](NANG-LUC-ENGINE.md),
> [ENGINE_CAPABILITIES.md](ENGINE_CAPABILITIES.md), [generation-guide.md](generation-guide.md).

---

# PHẦN 0 — Sự thật quan trọng nhất

**Khác biệt giữa ba tier KHÔNG nằm ở pipeline.** Từ khi Lite v2 lên (2026-08-02), cả ba tier chạy chung một chuỗi giải bài toán:

```text
composeStoryboard  →  applyStoryTemplate  →  fitTextInTimeline
 (giải shot list)      (compile recipe)       (fit chữ)
```

Ba tier chỉ khác nhau ở **ai sinh ra cái recipe đưa vào `applyStoryTemplate`**, và **độ sâu QA**:

| | Recipe đến từ | `source.origin` |
|---|---|---|
| Template | File `story-templates/*.json` do người art-direct | (không có) → solver chạy |
| Lite v2 | `lite-storyboard.json` do `composeStoryboard` giải | `composed` → solver bị bỏ qua |
| Premium | `storyboard.json` do `composeStoryboard` giải | `composed` → solver bị bỏ qua |

Hệ quả thực tế cần nhớ: **sửa `applyStoryTemplate.mjs`, `photoAssignment.mjs`, `musicRetime.mjs`, `composeStoryboard.mjs` hay `fitTextInTimeline.mjs` là chạm vào cả ba tier cùng lúc.** Chạy `npm run test:unit` đầy đủ, không chỉ test của tier đang sửa.

---

# PHẦN 1 — Chuỗi dùng chung

`scripts/runProject.mjs` là orchestrator duy nhất. Nó chia job thành 5 phase có thể `--resume`: `analyze → plan → build → render → qa → deliver`.

```text
                    ┌─────────── analyze ───────────┐
Raw photos + music  │  analyzeProject.mjs           │
+ prompt.txt        │    ├ analyzePhotos.mjs        │  rule-based, 0 AI
                    │    ├ analyzeMusic.mjs         │  rule-based, 0 AI
                    │    └ analyzePhotoContent.mjs  │  AI vision (premium/--ai-copy)
                    └───────────────┬───────────────┘
                                    ▼
                    ┌──────────── plan ─────────────┐
                    │  parseBrief.mjs   ← NODE 0     │  MỌI tier
                    │    prompt → directive ledger   │
                    │  generateSelectionPolicy.mjs   │
                    │  selectProjectPhotos.mjs       │
                    │  assessFit / decideFit         │
                    │  ── rẽ nhánh theo tier ──      │
                    └───────────────┬───────────────┘
                                    ▼
                    ┌──────────── build ────────────┐
                    │  composeStoryboard.mjs         │  giải shot list
                    │  applyStoryTemplate.mjs        │  compile → timeline
                    │  fitTextInTimeline.mjs         │  fit chữ (glyph thật)
                    │  auditCompliance.mjs --report  │  NODE 0b (biên nhận)
                    └───────────────┬───────────────┘
                                    ▼
                        render  →  qa  →  deliver
```

## 1.1. Node 0 — directive ledger (mọi tier)

`parseBrief.mjs` biên dịch `prompt.txt` của khách thành **ledger có kiểu**: danh sách order `{kind, op, scope, target, strength}`. Chạy **không phân biệt tier** (`runProject.mjs:396-400`) — *"an instruction is an instruction whether they paid for a template or for a director."*

Ledger đi tiếp vào `applyStoryTemplate` ở **cả ba tier**, và với Premium còn đi vào `composeStoryboard`, `generateStoryOptions`, `generateDirectorNotes`, `generateStoryPlan`.

> ⚠️ **Đây là lớp đang có lỗi P0 chưa sửa.** Một order `effect/set` có thể xoá ảnh khỏi phim mà không cổng nào báo. Xem [PREMIUM-QUALITY-STABILITY-PLAN.md](PREMIUM-QUALITY-STABILITY-PLAN.md).

## 1.2. Photo selection và fit decision

- `generateSelectionPolicy.mjs` → chính sách chọn ảnh cho job.
- `selectProjectPhotos.mjs` → `photos.selected.json`.
- `assessFit.mjs` / `decideFit.mjs` → quyết định ảnh-vs-nhạc: dùng full song, cắt highlight, loop, hay báo mismatch. Khi không hợp và không có `--accept-music-mismatch`, job **dừng ở exit 3** để người quyết định.

## 1.3. `composeStoryboard.mjs` — nơi bài toán được giải

Đây là bộ não sắp xếp, dùng chung cho Lite và Premium (Template dùng recipe người viết, nhưng vẫn qua cùng solver ở `templateShotList.mjs`).

Nó nhận photo pool + music analysis + (plan/director nếu có) và giải:

- `musicEdit` — cửa sổ nhạc (`resolveMusicWindow`, có đọc ledger)
- Số scene, số ảnh mỗi scene, hình dạng scene
- Vị trí montage, duration weights
- Xoay palette layout/effect theo **least-used** (`createRotor`), không modulo
- `fit` — biên bản: `photosUsed`, `budgetSecondsPerPhoto`, `boundBy`, `variety`

Output là một **recipe riêng cho job**, mang `source.origin: "composed"` — dấu hiệu báo `applyStoryTemplate` rằng shot list đã giải rồi, đừng giải lại.

## 1.4. `applyStoryTemplate.mjs` — compile recipe thành timeline

- `planTemplateShotList` — giải shot list (bỏ qua nếu `composed`)
- `applyToStoryboard` — áp directive ledger lên storyboard
- `buildPhotoAssignmentRequests` + `assignPhotos` — **gán ảnh toàn cục**, chống trùng trong scene và trùng `duplicateGroup` giữa scene lân cận, có reuse budget kèm lý do
- `retimeSlidesToMusic` — allocator duy nhất quyết định duration, assert drift ≤ 0,1s
- Ghi `analysis/photo-assignment.json` (kèm khối `timeline` đo trên file vừa ghi), `analysis/tier1_diversity.json`

## 1.5. `fitTextInTimeline.mjs` — fit chữ

Duyệt **cả** `slide.captions[]` lẫn `slide.layers[type=text]`, đo bằng glyph thật (`textMeasure.mjs` qua ffmpeg), wrap → shrink → rút gọn deterministic, áp reading-rate policy (18 ký tự/s tiếng Việt, 3 từ/s tiếng Anh), tự chèn backing surface khi chữ nằm trên ảnh. Còn blocker → `exit 1` → build chết.

## 1.6. QA — `qaLoop.mjs`

Ba lớp, chia theo chi phí:

```text
PRE-FLIGHT (miễn phí, không render)
  qaProxy.mjs → fix → qaProxy ... đến khi sạch
  bounded bởi fix-once + PREFLIGHT_SAFETY_CAP = 30 pass
        ▼
PRE-RENDER GATE  ← chặn nếu tier có finding action=block
        ▼
RENDER
        ▼
REVISE (đắt)  qaClip.mjs + qaProxy → fix → render lại
  mỗi vòng tốn 1 revision; cap --max-revisions
```

- `qaProxy.mjs` — đo trên timeline: pacing (hỏi **chính allocator**, không tự tính), hero, crop/face, text overflow, caption integrity, caption language, duplicate ảnh liền kề, drift timeline↔musicEdit, tier-1 quality gate.
- `qaClip.mjs` — đo trên frame đã render: too_dark / too_bright / flat.
- Mọi fix đều deterministic. Anti-oscillation: mỗi cặp `(scene, check)` chỉ sửa một lần.

## 1.7. Policy — `lib/rules/`

| File | Vai trò |
|---|---|
| `contract.mjs` | Registry rule: `check → { scope, repairs }`. Emit rule chưa khai báo = defect (test quét) |
| `policy.mjs` | Bảng **tier × rule → action** (`block` / `repair` / `manual-review` / `warn`) |
| `verdict.mjs` | `evaluateQualityReport()` — hàm DUY NHẤT ra `pass \| review \| block` |
| `thresholds.mjs` | Mọi ngưỡng phải được hai chỗ đồng thuận |

`qaLoop` và `deliver.mjs` gọi **cùng** `evaluateQualityReport` với **cùng** report → không còn cảnh `qa clean / deliver failed`.

## 1.8. Deliver — node 12

`deliver.mjs` kiểm tra drift timeline↔`musicEdit` **và** drift video-đã-render↔timeline, từ chối verdict cũ theo mtime, rồi đóng gói `final.mp4`, `preview.mp4` (60s có watermark), `thumbnail.jpg`, `project_summary.json`.

---

# PHẦN 2 — TEMPLATE

```text
plan:   parseBrief → selection policy → chọn ảnh → fit decision
        ├ pickRecipe.mjs          (--auto-recipe: AI chọn recipe)
        ├ chooseTier1Direction.mjs (style + pacing)
        └ writeRecipeCopy.mjs      (--ai-copy: viết lại lời cho couple này)
build:  applyStoryTemplate.mjs --template story-templates/<recipe>.json
        fitTextInTimeline.mjs
qa:     qaLoop.mjs --tier template --skip-initial-render
```

Recipe do người art-direct, nằm trong `story-templates/`. Scene **count** không do recipe quyết định — đó là số học đối với photo budget (`recipeShotList.mjs`); recipe chỉ sở hữu **look**.

Tiếng Việt dùng nguyên lời recipe (0 AI). Tiếng Anh bắt buộc `writeRecipeCopy` để không ship lời Việt.

---

# PHẦN 3 — LITE v2

```text
plan:   parseBrief → selection policy → chọn ảnh → fit decision
        └ generateProjectStory.mjs        ← 1 lần gọi AI (story JSON)
build:  generateProjectTimeline.mjs
          ├ adaptLiteStory()              ← deterministic, KHÔNG phải AI
          │   story → acts + screenCopy + styleProfile
          │   → analysis/lite-story-adapter.json
          ├ LITE_STYLE_PROFILES[...]      ← whitelist đã qua render smoke
          │   → analysis/lite-style-direction.json
          ├ composeStoryboard.mjs         → analysis/lite-storyboard.json
          └ applyStoryTemplate.mjs        → timeline.json
        fitTextInTimeline.mjs
qa:     qaLoop.mjs --tier lite --skip-initial-render
```

**Ba style profile** (`lib/liteStyleProfiles.mjs`): `white_wedding_gentle`, `warm_film_story`, `editorial_clean`. Mỗi profile định nghĩa theme, layout mix, effect palette, transition palette, font pairing, grade. Profile là **whitelist cấu hình**, không phải JSON tự do từ model.

Timeline Lite được pin bằng `metadata.pipelineVersion: "lite-v2"` + `qualityPolicyVersion: 2` + `styleProfile` + provenance. `resumeProject.mjs` không tái sử dụng timeline Lite v1.

**Policy của Lite nghiêm hơn hai tier kia** (`policy.mjs`): 8 hàng `BLOCK` so với 1 của Template/Premium — `must_use_coverage`, `text_safe_area`, `caption_integrity`, `closing_card`, `duplicate_photo`, `black_frame`, `music_edit`, `audio_drift`. Đây là kết quả có chủ ý của kế hoạch Lite: tier rẻ tiết kiệm bằng cách **giới hạn can thiệp sáng tạo**, không phải bằng cách ship hàng lỗi.

Chi tiết: [LITE-QUALITY-STABILITY-PLAN.md](LITE-QUALITY-STABILITY-PLAN.md), [LITE-QUALITY-STABILITY-PROGRESS.md](LITE-QUALITY-STABILITY-PROGRESS.md).

---

# PHẦN 4 — PREMIUM v1

```text
plan:
  parseBrief.mjs                    NODE 0   prompt → ledger
  selection policy / chọn ảnh / fit decision
  selectMusicEdit.mjs               GATE 4b  ← CHẠY TRƯỚC MỌI AI CALL
      photo không gánh nổi cả bài → HỎI KHÁCH, exit 3 = pending
  generateStoryOptions.mjs          NODE 3   4 hướng kể chuyện (A/B/C/D)
  selectStoryOption.mjs             NODE 4   cửa sổ phản hồi có hạn
  generateDirectorNotes.mjs         NODE 5+6 creative brief + director notes (gộp)
  generateStoryPlan.mjs             NODE 7   five-act plan

build:  renderWithRetry.mjs         NODE 8+9
  ┌── vòng lặp, tối đa --max-retries+1 lần ──────────────┐
  │ composeStoryboard.mjs    8a  CODE giải shot list      │
  │ writeRecipeCopy.mjs      8b  AI viết LỜI (chỉ lời)    │
  │ applyStoryTemplate.mjs   8c  compile → timeline       │
  │ fitTextInTimeline.mjs        fit chữ                  │
  │ engine --dry-run             validate                 │
  │   ảnh thiếu → prune pool → thử lại                    │
  │   vẫn fail  → HẠ MODE: director+copy bị rút           │
  └───────────────────────────────────────────────────────┘
  auditCompliance.mjs --report-only  NODE 0b  biên nhận

qa:     qaLoop.mjs --tier premium   NODE 10+11
        ← Premium là tier DUY NHẤT mà QA loop sở hữu việc render
        auditCompliance.mjs (gate)  NODE 0b  chặn nếu `must` bị gãy

deliver: deliver.mjs --tier <tier ĐÃ SỐNG SÓT>   NODE 12
```

### Bốn điều dễ hiểu sai về Premium

**1. AI không sinh `timeline.json`.** Đây là thay đổi lớn nhất so với bản tài liệu cũ. Phân vai:

| Ai | Quyết định gì |
|---|---|
| AI | Kể chuyện gì, cảm xúc gì, **lời trên màn hình** |
| Code | Bao nhiêu scene, ảnh nào vào đâu, dài bao lâu, effect gì, hợp lệ không |

`generateStoryClipV2` — hàm từng để AI sinh timeline — **đã bị xoá**.

**2. "Fallback về Lite" không phải fallback sang pipeline Lite.** Nó là **cùng pipeline đó, rút director và copywriter ra** (`renderWithRetry.mjs:107`, `mode = "lite"`). Khách nhận một bộ phim không lời dựng từ ảnh của chính họ, chứ không phải phim đội tên cặp đôi khác.

**3. Gate 4b chạy trước mọi AI call.** Nếu job dù sao cũng phải dừng hỏi khách, nó nên dừng khi chưa tốn đồng nào. `exit 3` = pending, không phải lỗi.

**4. Tier giao hàng là tier SỐNG SÓT.** Premium có thể tụt xuống lite giữa chừng; `renderWithRetry` ghi `tier.json` và `deliver` đọc nó, vì chỉ lần chạy đó mới biết.

---

# PHẦN 5 — So sánh ba tier (số thật)

| | Template | Lite v2 | Premium v1 |
|---|---|---|---|
| AI calls | 0 (vi) / 1 (en) | 1 | 4–6 |
| Khách chọn story | Không | Không | Có (4 hướng, non-blocking) |
| Khách được hỏi về nhạc | Không (luật tier-1) | Không | **Có** (gate 4b) |
| Recipe | Người art-direct | `composeStoryboard` | `composeStoryboard` + director notes |
| Ai viết lời | Recipe | AI story → adapter | AI copywriter |
| Storyboard composer | Chung | Chung | Chung |
| Global photo assignment | Chung | Chung | Chung |
| Music allocator | Chung | Chung | Chung |
| Text fitter | Chung | Chung | Chung |
| Verdict evaluator | Chung | Chung | Chung |
| Hàng `BLOCK` trong policy | 1 | **8** | 1 |
| QA revisions | 1 | 1 | `--max-revisions` (mặc định 2) |
| QA sở hữu render | Không | Không | **Có** |
| `pipelineVersion` trong timeline | ❌ | ✅ `lite-v2` | ❌ |
| Fallback | — | — | Hạ mode (rút director/copy) |

Bảng giá của bản cũ đã bỏ khỏi tài liệu này: giá là quyết định kinh doanh, thay đổi độc lập với code, và để ở đây thì nó sẽ cũ mà không ai biết.

---

# PHẦN 6 — Artifact mỗi job

```text
<project>/
  prompt.txt  project.json  directives.json      ← ledger (mọi tier)
  input/  music/
  analysis/
    photos.json  photos.selected.json  photo_content.json
    music/<track>.json
    selection_policy.json  fit_decision.json  fit_plan.json
    ── Lite ──
    story-template.generated.json  lite-story-adapter.json
    lite-storyboard.json  lite-style-direction.json
    ── Premium ──
    story_options.json  selected_story.json  selected_music.json
    director_notes.json  story_plan.json  storyboard.json
    recipe_copy.json  tier.json
    ── chung ──
    photo-assignment.json  text-fit.json  tier1_diversity.json
    compliance.json  job-manifest.json
    qa/  <base>.proxy.json  <base>.json  <base>.loop.json
         static-gate.json  final-verdict.json  <base>.contact.jpg
  timeline/timeline.json
  output/  final.mp4  deliver/
```

Artifact **project-local**, không ghi ra root dùng chung.

---

# PHẦN 7 — Orchestration & exit code

```bash
npm run template -- --project <p> --deliver
npm run lite     -- --project <p> --deliver
npm run premium  -- --project <p> --deliver
```

Cờ hay dùng: `--resume` · `--dry-run` · `--skip-qa` · `--max-revisions N` · `--choice A|B|C|D` · `--music-choice highlight|full` · `--accept-music-mismatch` · `--accept-brief-gaps` · `--allow-qa-flags`

Engine trả **exit code** làm hợp đồng: `0` OK · `1` lỗi validate · `2` lỗi FFmpeg (retry hạ tầng, không đổi JSON) · `99` không xác định. Xem [ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md#cli--exit-code).

`runProject` trả thêm `3` = **pending, đang chờ khách** (gate 4b hoặc node 4) — không phải lỗi, đừng retry tự động.

Tầng điều phối (n8n/cron/API) **chỉ gọi** `runProject.mjs`; nó không tự sinh lệnh FFmpeg và không chứa timeline engine.

---

# PHẦN 8 — Bản cũ đã sai ở đâu

Giữ lại để người đọc bản cũ (hoặc doc/blog dẫn lại nó) không kết luận sai.

| Bản cũ nói | Thực tế |
|---|---|
| AI sinh `timeline.json`, validate fail thì "gửi lỗi ngược cho AI sửa, retry 2–3 lần" | AI **không bao giờ** sinh timeline. Retry loop prune ảnh thiếu rồi **hạ mode**, không hỏi lại AI |
| "Fallback về Lite pipeline" | Cùng pipeline, rút director + copywriter |
| Lite = bảng tra cứu if/else (`Hero score cao → dark_feather`…) | Bảng đó **đã chết**. Lite v2 dùng chung composer + style profile whitelist |
| Lite = `generateProjectTimeline.mjs` sinh timeline trực tiếp | Nó là orchestrator gọi `composeStoryboard` + `applyStoryTemplate` |
| Lite QA chỉ có `qaClip.mjs`, "không có vòng QA semantic" | Lite chạy `qaLoop` đầy đủ và có policy **nghiêm nhất** trong ba tier |
| "Gộp node 5+6 thành 1 call" là *giải pháp đề xuất* | Đã làm: `generateDirectorNotes.mjs` |
| Không nhắc node 0 (ledger), gate 4b (nhạc), node 0b (compliance), node 12 (deliver) | Cả bốn đều đã tồn tại và đều là cổng thật |
| Không nhắc photo assignment toàn cục, music allocator, verdict evaluator | Đều là hạ tầng dùng chung của cả ba tier |
| Bảng giá theo tier | Bỏ — thuộc về tài liệu kinh doanh |

**Một sai lệch nội bộ đáng ghi:** comment header của `runProject.mjs` viết *"story options (3)"*, nhưng `generateStoryOptions.mjs:46,90` khai `IDS = ["A","B","C","D"]` và ép model trả *"exactly 4"*; `--choice` cũng nhận A|B|C|D. **Con số đúng là 4** — comment kia đã cũ.

---

# PHẦN 9 — Khiếm khuyết đã biết (2026-08-04)

1. **P0 — lớp directive không hạch toán ngân sách ảnh.** Nhánh non-montage của `applyToStoryboard` (`directiveApplication.mjs:126-133`) ép mọi cảnh trong scope về 1 ảnh mà không trả lại số ảnh giải phóng, và không ai tính lại duration sau đó. Đo trên một job Premium thật: **mất 16 ảnh, 47 giây phim là 7 cảnh tĩnh liên tiếp, `qaProxy` vẫn `verdict=ok`.**
   Vì `parseBrief` chạy cho mọi tier và cả ba tier đều truyền ledger vào `applyStoryTemplate`, **đây là lỗi dùng chung, không riêng Premium.** Premium bị nặng nhất vì act-scope khớp tên act của nó (`opening`/`love_story`/`ceremony`), trong khi Lite đặt act là `beat_01..beat_08` nên directive scope-act trượt — một sự miễn nhiễm tình cờ, không phải thiết kế. Scope `global` thì trúng cả ba tier.
   → [PREMIUM-QUALITY-STABILITY-PLAN.md](PREMIUM-QUALITY-STABILITY-PLAN.md)

2. **`pipelineVersion` chỉ Lite ghi.** Timeline Template/Premium có `metadata` rỗng → không provenance, và `preflightTimeline.ts:282` khiến check caption là `errors` cho Lite / `warnings` cho hai tier kia.

3. **Policy Template/Premium gần như không có hàng `BLOCK`** → fail sau khi đã trả tiền encode thay vì trước.

4. **`composeStoryboard --strict`** (cổng `fit.verdict`) không script nào truyền.

5. **Chưa có regression Premium.** Lite có 4 test file + fixture; Premium chỉ có `premium-playlist.test.mjs`.
