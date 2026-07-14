# Pipeline sản xuất video cưới — v1 (Premium) & Lite (Cơ bản/Vừa)

Tài liệu này gộp 2 pipeline dùng cho 2 phân khúc giá khác nhau:
- **v1 (Premium)** — AI đóng vai đạo diễn thật, khách tương tác chọn hướng kể chuyện. Dùng cho gói giá cao.
- **Lite (Cơ bản/Vừa)** — tận dụng tối đa phần rule-based đã có sẵn trong engine, gần như không tốn AI. Dùng cho gói giá thấp/trung.

Nguyên tắc chọn tier: nếu khách trả premium cho trải nghiệm cá nhân hoá + chờ được → dùng v1. Nếu khách cần giá tốt + giao nhanh → dùng Lite.

> **Nền tảng chung**: cả 2 tier đều xuất ra `timeline.json` rồi đưa qua **cùng một render
> engine** đã hoàn thiện (29 effect, 56 transition, color grade, overlay + light-leak,
> audio graph, easing). Xem [ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md) (engine chạy
> thế nào), [NANG-LUC-ENGINE.md](NANG-LUC-ENGINE.md) / [ENGINE_CAPABILITIES.md](ENGINE_CAPABILITIES.md)
> (năng lực + spec timeline), [generation-guide.md](generation-guide.md) (brief cho AI Director).

> **Trạng thái triển khai (2026-07-13)**:
> - **Template** — recipe-driven, 0 call AI, co giãn theo album + nhạc:
>   `npm run template -- --project <p>`.
> - **Lite** — chạy end-to-end qua orchestrator chung:
>   `npm run lite -- --project <p>`.
> - **v1 Premium** — các node Story Options, User Choice, Music Window, Creative Brief,
>   Director Notes, Story Plan, validate/retry/fallback, QA loop và deliver đã nối end-to-end:
>   `npm run premium -- --project <p>`. Không có key thì dùng STUB tất định; còn phải smoke test
>   với key thật và đưa orchestration production vào vận hành. Guardrail JSON (Phụ lục A) vẫn là
>   ranh giới: validate + normalize whitelist enum, chặn field lạ và kiểm tra ràng buộc chéo.

---

# PHẦN 1 — PIPELINE V1 (PREMIUM)

> Triết lý gốc: **AI không nên generate `timeline.json` ngay lập tức.** AI phải hiểu ảnh trước, nghĩ như một đạo diễn, quyết định cách kể chuyện, rồi mới chuyển quyết định đó thành timeline kỹ thuật.

## Sơ đồ tổng quan

```text
Raw Photos + Music + Prompt
        │
        ▼
Asset Catalog
        │
        ▼
Photo Curation & Enhancement
        │
        ▼
Selected / Enhanced Photos
        │
        ▼
Story Options (4 lựa chọn)
        │
        ▼
User Chooses Story
        │
        ▼
Creative Brief
        │
        ▼
Director Notes
        │
        ▼
Story Plan
        │
        ▼
Timeline JSON
        │
        ▼
Validate / Dry-run
        │
        ▼
Render Engine
        │
        ▼
QA / Fix
        │
        ▼
Final MP4
```

## 1. Input Node

**Input:** Raw Photos, Music, User Prompt, độ dài video mong muốn (tuỳ chọn), phong cách ưu tiên (tuỳ chọn).

Ví dụ: *"Làm video cưới 5 phút, cảm xúc, phong cách điện ảnh Hàn Quốc."*

---

## 2. Photo Curation & Enhancement Node

**Mục tiêu:** hiểu ảnh trước khi kể chuyện.

**Trách nhiệm:**
- *Phân tích ảnh:* nhận diện cô dâu/chú rể, gia đình/bạn bè, lễ cưới, chân dung, cảm xúc, ảnh trùng, ảnh mờ, ảnh thiếu sáng.
- *Chấm điểm ảnh:* Quality Score, Emotion Score, Story Importance, Hero Score.
- *Chọn ảnh:* Hero photos, Supporting photos, Background photos. Loại: ảnh mờ, ảnh trùng, ảnh không liên quan.
- *Lên kế hoạch enhance:* brightness, contrast, sharpen, noise reduction, warm tone, vignette — chỉ enhance ảnh đã chọn, không phí công cho ảnh bị loại.

**✅ Giải pháp cho vướng mắc "chưa map script thực tế":**
Node này **mở rộng** `analyzePhotos.mjs` đã có sẵn (rule-based, không tốn AI cho phần chấm điểm kỹ thuật: độ nét, sáng/tối, trùng lặp) — chỉ phần **nhận diện nội dung** (cô dâu/chú rể, cảm xúc, hero score theo ngữ cảnh câu chuyện) mới cần gọi AI vision model, và nên gọi **1 lần duy nhất cho toàn bộ batch ảnh** (1 request nhiều ảnh) thay vì từng ảnh riêng lẻ, để giảm số round-trip.

**Output:** `image_manifest.json`, `selected_photos.json`, `enhancement_plan.json`, `enhanced_assets/`.

## 2b. Asset Catalog Node

**Mục tiêu:** biến font/overlay/background/frame local thành menu ngắn để AI Director chọn bằng
`assetId`, không đọc path thô và không tự bịa tài nguyên.

Chạy:

```bash
npm run analyze:assets
```

Output:

- `analysis/assets_catalog.full.json` — code dùng để map `assetId → path`.
- `analysis/assets_catalog.ai.json` — AI Director đọc: `id`, `label`, `summary`, `mood`,
  `bestFor`, `roles`, `variant`.

Guardrail: AI chỉ được trả id có trong catalog; id lạ bị bỏ về `null`. Timeline cuối vẫn chỉ dùng path local
đã validate, không trỏ URL web.

---

## 3. Story Options Node

**Mục tiêu:** sinh ra **4 cách kể chuyện khác nhau**. Chỉ bàn về cảm xúc/kể chuyện, không bàn effect kỹ thuật.

Ví dụ: **A** — Luxury Wedding Film (elegant, slow, minimal text) · **B** — A Day To Remember (chronological, emotional, warm) · **C** — Korean Romance (dreamy, soft, bright, gentle) · **D** — Family & Friends (focus relationships, joy, warm ending).

**✅ Giải pháp cho vướng mắc "Story Options phá vỡ turnaround nhanh":**
Không chờ khách phản hồi đồng bộ (blocking). Thay vào đó:
- Gửi 4 lựa chọn qua kênh khách đang dùng (Zalo/Messenger) kèm **cửa sổ phản hồi 24h**.
- Trong lúc chờ, hệ thống **tiếp tục xử lý các job khác** — không giữ tài nguyên render chờ 1 khách.
- Nếu hết 24h không phản hồi: **tự động chọn phương án có tổng điểm phù hợp cao nhất** (dựa trên `Story Importance`/`Emotion Score` đã tính ở node 2) làm mặc định, vẫn đảm bảo SLA giao hàng thay vì treo vô thời hạn.

**Output:** `story_options.json`.

---

## 4. User Choice Node

Khách chọn 1 trong 4. Ví dụ: *"Tôi chọn C."*

---

## 5. Creative Brief Node

Chuyển hướng đã chọn thành định hướng sáng tạo: style tổng thể, emotional arc, color mood, triết lý caption, nhịp phim, cấu trúc câu chuyện, quy tắc chọn ảnh.

**✅ Giải pháp cho vướng mắc "quá nhiều lần gọi AI (7+)":**
**Gộp node 5 + node 6 (Director Notes) thành 1 lần gọi AI duy nhất.** Hai node này về bản chất là 1 chuỗi suy luận liên tục (từ "định hướng sáng tạo" → "áp dụng cụ thể vào công cụ engine có sẵn") — không cần tách thành 2 round-trip API riêng, chỉ cần 1 prompt có cấu trúc 2 phần rõ ràng, AI trả về JSON gộp cả `creative_brief` lẫn `director_notes` trong 1 response. Giảm được 1 lần gọi AI mà không mất chất lượng suy luận.

**Output:** `creative_brief.json`.

---

## 6. Director Notes Node

AI đóng vai **đạo diễn** — đọc năng lực engine (29 effect, 56 transition, color grade...) và quyết định cách dùng.

Ví dụ mapping: Hero photos → `dark_feather` · Portraits → `portrait_blur_background` · Group photos → `collage_grid` · Memory scenes → `memory_wall` · Fast montage → `film_roll_left` · Opening → `slow_zoom_in` · Ending → `fade_slow`.

Khách không thấy chi tiết kỹ thuật — AI quyết định hết.

**✅ Giải pháp cho vướng mắc "chưa có guardrail JSON":**
Node này **bắt buộc** áp đúng 4 nguyên tắc đã thống nhất trước (xem Phụ lục A cuối tài liệu):
1. Chỉ chọn effect/transition trong whitelist enum (29 effect, 56 transition có sẵn) — không tự bịa tên.
2. Không tự tính số học nhạy cảm (duration, tọa độ) — các số này lấy từ `analyzeMusic.mjs`/`analyzePhotos.mjs` đã tính sẵn, AI chỉ **chọn/sắp xếp**.
3. Validate lại output y hệt JSON viết tay (referential integrity, bounds check, tổng duration khớp nhạc).
4. AI không có quyền set path file, quality preset, hay bất kỳ config hệ thống nào — chỉ sinh nội dung timeline.

**Output:** `director_notes.json`.

---

## 7. Story Plan Node

Dựng cấu trúc phim: Opening → Love Story → Ceremony → Family & Friends → Ending. Mỗi đoạn có: mục tiêu, cảm xúc, nhịp độ, ảnh dùng, ý tưởng caption, effect ưu tiên.

**Output:** `story_plan.json`.

---

## 8. Timeline Generation Node

Sinh `timeline.json` — tuân thủ schema engine, transition/effect hợp lệ, file tồn tại, duration hợp lệ, caption timing hợp lệ, chỉ dùng ảnh đã chọn.

**✅ Giải pháp cho vướng mắc "chưa map script thực tế":**
Node này chính là `generateStoryClipV2.mjs` + `fitTextInTimeline.mjs` đã có sẵn trong engine — không cần viết mới, chỉ cần feed thêm `director_notes.json` + `story_plan.json` làm input bổ sung (ngoài `analysis/photos.json` + `analysis/music/*.json` đã có) để 2 script này bám theo quyết định của "đạo diễn" thay vì chỉ theo rule mặc định.

`timeline.json` là **kế hoạch thực thi**, không phải bản thân tác phẩm sáng tạo.

---

## 9. Validate / Dry-run Node

Render Engine validate: JSON Schema, file thiếu, caption timing, audio, layer, transition, duration.

**✅ Giải pháp cho vướng mắc "chưa có cơ chế retry":**
Nếu validate fail: gửi lỗi cụ thể ngược lại cho AI (vd *"effect 'zoom_dreamy' không tồn tại, chọn lại từ danh sách"*), cho **tối đa 2-3 lần retry**. Nếu vẫn fail: **fallback về Lite pipeline** (xem Phần 2) cho đúng batch ảnh đó thay vì để job treo vô thời hạn — khách vẫn nhận được video, chỉ không đúng 100% ý đạo diễn AI.

```
timeline.json → AI fixes → Validate lại (tối đa 2-3 lần) → nếu vẫn fail → fallback Lite
```

---

## 10. Render Node

Input: `timeline.json`, `enhanced_assets`, `music`. Output: `final.mp4`.

---

## 11. QA / Fix Node

Phân tích video đã render: too dark, too bright, pacing kém, chọn hero sai, caption tràn, mở đầu/kết thúc yếu.

**✅ Giải pháp cho vướng mắc "QA thẩm mỹ khó validate, nguy cơ lặp vô hạn":**
Tách QA thành 2 lớp thay vì 1 lớp "thẩm mỹ" mơ hồ:
- **Lớp đo được (giữ nguyên, rule-based):** too_dark/too_bright/flat — dùng `qaClip.mjs` hiện có, không tốn AI.
- **Lớp cần AI nhưng có proxy đo được thay vì chủ quan:**
  - *"Pacing kém"* → đo bằng độ lệch giữa duration slide thực tế và đường năng lượng nhạc đã phân tích (`analyzeMusic.mjs`) — nếu lệch quá ngưỡng, coi là fail, không cần AI "cảm nhận" lại.
  - *"Chọn hero sai"* → đối chiếu lại `Hero Score` đã tính ở node 2, không chấm lại từ đầu.
  - *"Mở đầu/kết thúc yếu"* → đây là điểm duy nhất thực sự cần AI vision chấm lại (chủ quan, không đo được bằng số).
- **Giới hạn cứng: tối đa 2 lần revise** cho lớp cần AI. Sau 2 lần vẫn fail → giao bản hiện tại + flag để người xem lại thủ công, không lặp vô hạn.

```
QA Report → AI sửa Story Plan → AI sửa Timeline → Render lại (tối đa 2 lần)
```

---

## 12. Final Output

`final.mp4`, `preview.mp4`, `thumbnail.jpg`, `project_summary.json`.

---

## Triết lý cốt lõi

Pipeline tách riêng **tư duy sáng tạo** khỏi **thực thi kỹ thuật**:

```
Raw Photos → Photo Understanding → Story Selection → Creative Direction
→ Director Decisions → Story Planning → Timeline Generation → Rendering
```

AI nên nghĩ như **đạo diễn phim**, không phải máy tạo slideshow. Render engine nên hành xử như **ê-kíp quay phim**, thực thi chính xác quyết định của đạo diễn. `timeline.json` không phải tác phẩm sáng tạo — nó là **ngôn ngữ kỹ thuật** để chuyển quyết định sáng tạo thành phim hoàn chỉnh.

---

## Phụ lục A — Nguyên tắc an toàn khi AI generate JSON (áp dụng cho node 6, 8)

1. **Constrained output**: bắt AI trả đúng JSON Schema, không tự do viết field mới.
2. **Whitelist enum**: mọi effect/transition/color preset phải nằm trong danh sách hợp lệ đã liệt kê trong system prompt.
3. **Không để AI tự tính số nhạy cảm**: duration, tọa độ, thời điểm cắt cảnh do code tính sẵn từ `analyzeMusic`/`analyzePhotos`, AI chỉ chọn/sắp xếp.
4. **Validate như JSON viết tay**: referential integrity (file tồn tại), tổng duration khớp nhạc, bounds check (opacity/scale/position trong khoảng hợp lệ).
5. **Retry có giới hạn + fallback**: lỗi validate → gửi lại lỗi cụ thể cho AI, tối đa 2-3 lần → nếu vẫn fail, fallback timeline mặc định (rule-based).
6. **Cách ly quyền hạn**: AI chỉ sinh nội dung timeline, không được set path file, quality preset, hay bất kỳ config hệ thống nào.

---

# PHẦN 2 — PIPELINE LITE (CƠ BẢN / VỪA)

Nguyên tắc cốt lõi: `analyzePhotos.mjs`, `analyzeMusic.mjs`, `qaClip.mjs` đã là **rule-based, không dùng ML** — tận dụng tối đa phần miễn phí này, chỉ dùng AI ở đúng 1 điểm cần thiết (diễn giải brief), hoặc bỏ hẳn AI ở gói rẻ nhất.

## Sơ đồ

```text
Raw Photos + Music + (Brief ngắn, có thể bỏ trống)
        │
        ▼
Photo + Music Analysis          ← rule-based, KHÔNG tốn AI
   (analyzePhotos.mjs + analyzeMusic.mjs, đã có sẵn)
        │
        ▼
Interpret Brief                  ← 1 lần gọi AI DUY NHẤT (chỉ gói Vừa)
   (câu hỏi trắc nghiệm → JSON có cấu trúc)
   Gói Cơ bản: BỎ QUA bước này, dùng default cố định
        │
        ▼
Rule-Table Mapping               ← rule-based, KHÔNG tốn AI
   (mood/structure → effect/transition theo bảng tra cứu cố định)
        │
        ▼
Timeline Generation              ← rule-based, KHÔNG tốn AI
   (generateStoryClipV2.mjs đã có, ghép analysis + rule table)
        │
        ▼
Validate / Dry-run
        │
        ▼
Render Engine
        │
        ▼
QA kỹ thuật (--fix)              ← rule-based, KHÔNG tốn AI
   (qaClip.mjs hiện có: too_dark/too_bright/flat, KHÔNG có
    vòng QA thẩm mỹ semantic)
        │
        ▼
Final MP4
```

## Bảng tra cứu thay "Director Notes" (rule cố định, ví dụ rút gọn)

| Loại ảnh (từ `analyzePhotos.mjs`) | Effect mặc định |
|---|---|
| Hero score cao, ảnh dọc | `dark_feather` |
| Portrait, ảnh dọc thường | `portrait_blur_background` |
| Nhóm ≥3 người | `collage_grid` |
| Điểm cảm xúc cao, nhiều ảnh liên quan | `memory_wall` |
| Đoạn nhạc năng lượng cao (từ `analyzeMusic.mjs`) | `film_roll_left`/`right` |
| Slide mở đầu | `slow_zoom_in` |
| Slide kết thúc | `fade_slow` (transition) |

Bảng này "đóng băng" phần não Director Notes của v1 thành if/else — mất khả năng thích ứng tinh tế theo brief riêng, đổi lại **0 chi phí AI** cho bước này.

---

# So sánh 3 tier

| | Lite — Cơ bản | Lite — Vừa | v1 Premium |
|---|---|---|---|
| Số lần gọi AI/video | 0 | 1 (Interpret Brief) | 2-3 (đã gộp bớt theo giải pháp trên, kèm revise tối đa 2 lần) |
| Khách có chọn story không | Không | Không (chỉ điền brief ngắn) | Có (4 lựa chọn, non-blocking 24h) |
| QA | Kỹ thuật, 1 lần fix | Kỹ thuật, 1 lần fix | Kỹ thuật + 1 lớp thẩm mỹ có proxy đo được, tối đa 2 lần revise |
| Thời gian giao | Nhanh nhất (24h) | Nhanh (24-48h) | 24h xử lý + tối đa 24h chờ khách chọn story |
| Giá đề xuất | 400-600k | 700k-1.8M | 2-6M (custom story cao cấp / hybrid AI video) |
| Fallback khi lỗi | Không cần (không có AI để lỗi) | Fallback default nếu Interpret Brief fail | Fallback về Lite pipeline nếu validate fail sau 3 lần retry |

## Vì sao giữ 2 pipeline song song thay vì hạ cấp v1

- Rule-table dễ maintain, debug hơn AI tự do — lỗi effect sai chỉ cần sửa 1 dòng bảng.
- Không rủi ro AI drift ở gói rẻ — kết quả nhất quán giữa các job.
- Tạo đường upsell tự nhiên: khách dùng Lite thấy đẹp → chào nâng lên Premium có Story Options thật.

---

# Orchestration & triển khai

Khi tự động hóa (n8n, cron, hoặc API sau này), tầng điều phối **chỉ gọi** engine, **không**
tự sinh lệnh FFmpeg và **không** chứa Timeline Engine. Ranh giới trách nhiệm:

```text
Trigger (thủ công / lịch / webhook)
→ Quét thư mục ảnh + nhạc
→ [tier template/lite/premium] runProject.mjs → timeline.json
→ Execute:  npm run render -- --timeline timeline/<job>.json
→ Thu output/final.mp4 + logs
```

- Engine trả **exit code** làm hợp đồng: `0` OK · `1` lỗi validate (đưa lỗi cho AI sửa
  timeline) · `2` lỗi FFmpeg (retry hạ tầng, không đổi JSON) · `99` không xác định.
  Xem [ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md#cli--exit-code).
- Chạy `--dry-run` trong node validate để bắt lỗi timeline **trước khi** tốn thời gian encode.
- Mỗi job nên có timeline + output path riêng để chạy song song nhiều khách (không giữ
  tài nguyên chờ 1 khách phản hồi — khớp với cơ chế non-blocking 24h ở node 3).
- Ví dụ lệnh điều phối:

  ```bash
  cd /path/to/SlideshowRenderEngine && npm run render -- --timeline timeline/<job>.json
  ```

Khi CLI ổn định, có thể bọc thành `POST /render` (body = timeline.json → jobId) mà không
đụng vào engine — CLI local phải chạy chắc trước.
