# Trạng thái hiện tại & kế hoạch

> Tài liệu **sống** — cập nhật mỗi khi xong một bước. Cập nhật cuối: **2026-07-10** (Phase F một
> phần: node 12 `deliver.mjs` + `schema/project-summary.schema.json`, nối vào `renderWithRetry --deliver`).
>
> Legend: ✅ xong · 🟡 một phần · ⬜ chưa làm

Bảng này theo dõi khoảng cách giữa **thiết kế** ([PIPELINE-V1-VA-LITE.md](PIPELINE-V1-VA-LITE.md))
và **hiện trạng code**. Số node dưới đây trỏ tới node trong tài liệu pipeline đó.

---

## 1. Tổng quan

| Tầng | Trạng thái | Ghi chú |
|---|---|---|
| **Render engine** | ✅ Feature-complete | 23 effect, 56 transition, color grade, overlay + light leak, audio graph, easing. Xem [NANG-LUC-ENGINE.md](NANG-LUC-ENGINE.md) |
| **Pipeline Lite** (Cơ bản/Vừa) | ✅ Chạy end-to-end | `node scripts/buildClip.mjs --fix` — rule-based, 0 AI |
| **Pipeline v1 Premium** | 🟡 A→E xong, F một phần | Node 2 (vision) wired **OpenAI gpt-5.5**, node 3/5+6/7 (story/brief/director/plan) wired **DeepSeek**, cả hai có guardrail; timeline node (8) bám director & PASS dry-run; node 9 `renderWithRetry.mjs` validate→retry→fallback Lite; node 11 `qaProxy.mjs` + `qaLoop.mjs` (pacing/hero proxy, trần 2 revise); node 12 `deliver.mjs` đóng gói 4 deliverable. Còn node 4 (user choice) + điều phối |
| **Docs** | ✅ Đã tổ chức lại (2026-07-08) | 10 file, hub tại [README.md](README.md) |

---

## 2. Đã xong

**Engine (nền tảng, đã verify bằng render thật):**
- Pipeline validate → normalize → face-safe → preflight → image-cache → compile → render → QA.
- 23 effect ảnh, 56 transition, caption tiếng Việt, color grading đầy đủ, audio graph
  (playlist/crossfade/automation/voiceover ducking), 4 quality preset.

**Bổ sung phiên 2026-07-08:**
- ✅ `light_leak_overlay` — 3 asset procedural (`warm`/`soft`/`sunset`) qua
  `scripts/generateLightLeaks.mjs`; overlay nhận `variant` + blend `add`.
- ✅ Easing chuyển động — `gentle`/`snap`/`bounce` cho 10 effect zoom/pan/kenburns.
- ✅ Tổ chức lại toàn bộ docs.
- ✅ **AI Director — tầng suy luận sáng tạo (Phase A+B)**: node 2 vision + node 3/5+6/7
  (Story Options, Creative Brief+Director Notes, Story Plan) wired DeepSeek (raw fetch,
  OpenAI-compatible) qua `scripts/lib/deepseek.mjs`; guardrail Phụ lục A đã kiểm thử đối kháng.
  Không key → STUB tất định, pipeline vẫn chạy. Chi tiết ở §3.

**Bổ sung phiên 2026-07-09:**
- 🐛 **Sửa lỗi `analyzePhotos.mjs` ghi số 0 âm thầm** (phát hiện khi làm Phase E). Khi `ffprobe`/
  `ffmpeg` không chạy được, `(r.stdout || "0x0")` và `rgbFrame() → null` khiến script ghi ra
  `photos.json` **hợp lệ về hình thức nhưng chết về nội dung**: `w=h=0` → mọi ảnh thành
  `landscape`, `quality=0` → `qualityNorm=0` hết → `takeBest()` hết tác dụng (hero = thứ tự file),
  `focusX/focusY` về mặc định → crop face-safe tê liệt. File trong repo **đang ở trạng thái này**
  (82/82 record rỗng) — validate + dry-run vẫn PASS nên không ai thấy. Nay hai probe **báo lỗi to
  và không ghi gì**; thêm chốt chặn "mọi ảnh cùng quality" → abort. Đã regen `photos.json`
  (37 portrait / 45 landscape, 81 focus point) và `photo_content.json` (89 → 82, hết lệch với `input/`).
- ✅ **Phase E — QA proxy + vòng revise có trần** (chi tiết ở §3).

**Bổ sung phiên 2026-07-10:**
- ✅ **Node 12 — Deliverables** `scripts/deliver.mjs` (chi tiết ở §3, Phase F). Nguyên tắc xuyên
  suốt: **không tuyên bố phán đoán mà pipeline chưa từng đưa ra** — thumbnail nói rõ luật nào đã
  chọn nó, `tier` không đoán, khối `director` chỉ đính khi được quy trách nhiệm rõ ràng.

**Pipeline Lite:** `buildClip.mjs` chuỗi analyze ảnh/nhạc → `generateStoryClipV2` →
`fitTextInTimeline` → render → `qaClip` → (với `--fix`) đổi hero ảnh tối/phẳng, render lại 1 lần.

---

## 3. Kế hoạch xây v1 Premium

Thứ tự theo phụ thuộc: mỗi phase mở khóa phase sau. Đánh dấu ✅ khi xong.

### Phase A — Hiểu ảnh bằng AI (node 2)
Nền tảng cho mọi quyết định "đạo diễn" phía sau.
- ✅ Contract `schema/photo-content.schema.json`: vocab tag whitelist (22 tag) + enum
  emotion (7) + score Hero/Emotion/Story (0–1); tách `$defs/aiResult` (model chỉ trả
  index + tag/score, **không** path/config) khỏi `photoRecord` (merged).
- ✅ Scaffold `scripts/analyzePhotoContent.mjs`: đọc `photos.json` → batch → `callVisionModel`
  (STUB deterministic) → `validateAiResults` (drop tag lạ, clamp score, index integrity) →
  merge kỹ thuật + ngữ nghĩa → `analysis/photo_content.json`. Chạy thật trên 89 ảnh, output
  validate sạch bằng zod. `generatedBy: "stub"` đánh dấu field ngữ nghĩa chưa phải AI thật.
- ⛔ **DeepSeek API không phục vụ vision** (xác minh 2026-07-09 trên api-docs.deepseek.com,
  3 nguồn khớp nhau). `/chat/completions` nhận `messages[].content` là **string thuần** — không có
  content-part `image_url`; `list-models` chỉ trả `deepseek-v4-flash` và `deepseek-v4-pro`, đều
  text-only. Vision chỉ có ở **giao diện chat.deepseek.com**, không có trên API.
- ✅ **Chốt provider vision = OpenAI `gpt-5.5`** (2026-07-09). DeepSeek vẫn giữ nguyên cho các node
  **text** (Phase B) — chỉ riêng node 2 đổi nhà. Code không phải viết lại: nó vốn nói giọng OpenAI,
  nên đây chỉ là đổi default. Env: `OPENAI_API_KEY` (hoặc `VISION_API_KEY`), `VISION_BASE_URL`
  (mặc định `https://api.openai.com/v1`), `VISION_MODEL` (mặc định `gpt-5.5`),
  `VISION_REASONING_EFFORT` (low/medium/high; bỏ trống = mặc định của model). Đổi sang OpenRouter /
  Azure / Gemini-compat chỉ cần set các biến này.
- ⚠️ **Bẫy `temperature`.** `gpt-5.5` là **reasoning model**: gửi kèm `temperature` → `400 Unsupported
  value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.`
  Nó lái bằng `reasoning_effort` chứ không phải sampling param. `gpt-4o` thì ngược lại: nhận
  `temperature`, từ chối `reasoning_effort`. Nên body được **dựng theo dòng model** (`IS_REASONING_MODEL`),
  không dùng chung. `gpt-5.5` vẫn chạy `/v1/chat/completions` + `image_url` + `response_format:json_object`
  (docs khuyên Responses API, nhưng node này chỉ cần 1 lượt JSON, không tool/multi-turn).
- ✅ Nếu `VISION_BASE_URL` trỏ vào `*.deepseek.com` → **từ chối trước, không bắn request chắc chắn
  hỏng**, ở lại STUB kèm lý do; `--require-vision` biến từ chối thành fail cứng (exit 1) cho pipeline
  không được phép âm thầm xuống cấp. `generatedBy` ghi `vision:<host>/<model>`.
- ✅ Verify bằng mock OpenAI server (2026-07-09): request gửi đi đúng `POST /v1/chat/completions`,
  `Bearer <key>`, `response_format=json_object`, 2 content-part `image_url` dạng data-URI JPEG thật.
  Ba biến thể body đều đúng: `gpt-5.5` → **không** `temperature`; `gpt-5.5` + `VISION_REASONING_EFFORT=low`
  → có `reasoning_effort`; `gpt-4o` → `temperature` trở lại, không `reasoning_effort`.
  JSON-mode không ép schema → guardrail `validateAiResults` là lớp gánh chính, và nó chặn đủ: tag lạ
  bị drop, `emotion` ngoài enum → default, `heroScore: 7.5` → clamp về 1.
- 🟡 **Còn lại**: chạy thật 1 lần trên 82 ảnh bằng key OpenAI để kiểm chất lượng tag/hero.

**Model DeepSeek đã chốt (2026-07-09)** — dùng cho các node **text** (Phase B):
| | id | ghi chú |
|---|---|---|
| Mặc định | `deepseek-v4-flash` | rẻ/nhanh — `$0.14`/1M in (cache miss), `$0.28`/1M out |
| Mạnh hơn | `deepseek-v4-pro` | `$0.435`/1M in, `$0.87`/1M out (~3×) |

`deepseek-chat` và `deepseek-reasoner` **chỉ là alias** và bị gỡ hẳn **2026/07/24 15:59 UTC**:
`deepseek-chat` = `deepseek-v4-flash` + thinking **disabled**; `deepseek-reasoner` = cùng model +
thinking **enabled**. Nên `lib/deepseek.mjs` ghim `deepseek-v4-flash` và gửi kèm
`thinking: {type:"disabled"}` để **tái lập đúng hành vi cũ** — các node này cần một bộ phát JSON
điều khiển được, không cần reasoner (thinking đắt hơn, chậm hơn, và docs không khẳng định nó
tương thích với `response_format`). `frequency_penalty`/`presence_penalty` đã deprecated — không gửi.

### Phase B — Suy luận sáng tạo (node 3, 5+6, 7) — ✅ wired + guardrail đã verify
Hạ tầng chung: `scripts/lib/deepseek.mjs` (client text→JSON dùng chung, raw `fetch`,
OpenAI-compatible, retry, `hasKey()`→STUB) + `scripts/lib/checkSchema.mjs` (harness check
JSON-Schema không cần thêm dep). Không key `DEEPSEEK_API_KEY` → mọi node tự về STUB.
- ✅ **Story Options** (node 3) — `scripts/generateStoryOptions.mjs` + `schema/story-options.schema.json`.
  Code tính **profile tất định** (phân bố tag/emotion/orient + heroCount) từ `photo_content.json`,
  AI chỉ đề xuất 4 hướng kể (chỉ cảm xúc, không effect/transition). Guardrail: ép đúng 4 option,
  id A–D do code gán, `pacing` enum, string trim/cap. `recommended` = option đầu (best-fit-first).
- ✅ **Creative Brief + Director Notes gộp 1 call** (node 5+6) —
  `scripts/generateDirectorNotes.mjs` + `schema/director-notes.schema.json`. 1 prompt 2 phần →
  `creative_brief` (định tính) + `director_notes` (ngôn ngữ engine). **Guardrail Phụ lục A gánh chính**:
  whitelist effect/transition/curves nạp trực tiếp từ `timeline.schema.json` (1 nguồn sự thật, không drift);
  giá trị lạ → default an toàn; **cách ly quyền** (bỏ mọi field path/quality/duration/tọa độ AI cố nhét).
- ✅ **Story Plan** (node 7) — `scripts/generateStoryPlan.mjs` + `schema/story-plan.schema.json`.
  5 màn Opening→Love→Ceremony→Family→Ending; mỗi màn: goal/emotion/pacing/emphasis/photoTags/
  priorityEffect/captionIdea. Guardrail: segment về đúng thứ tự chuẩn (dedup), enum-clamp emotion/pacing/
  emphasis/effect, lọc tag về vocab. **`emphasis` = enum low/med/high (KHÔNG phải duration)** — số giây do
  timeline node (Phase C) tính từ năng lượng nhạc.
- ✅ **Đã verify**: `node --check` sạch; 3 node chạy end-to-end STUB, output validate sạch bằng harness;
  và chạy path DeepSeek **thật** qua mock server trả JSON **cố tình sai** (effect bịa, tag ngoài vocab,
  sai kiểu, thiếu entry, nhét filePath/quality/duration) → mọi giá trị bị clamp về hợp lệ (kiểm bằng
  assert). Còn lại: cắm key thật + chốt model id V4 rồi chạy 1 lần kiểm chất lượng nội dung.

### Phase C — Sinh timeline theo đạo diễn (node 8) — ✅ xong + verify qua engine thật
- ✅ `generateStoryClipV2.mjs` nhận thêm `director_notes.json` + `story_plan.json` (tự nạp từ
  `analysis/` nếu có; `--director/--plan <path|none>`). Áp quyết định đạo diễn:
  `montageEffect` → effect montage; `defaultTransition` → transition giữa slide; `endingTransition`
  → transition vào slide kết; `colorCurves` → thêm preset `curves` vào grade tổng; `overlayVariant`
  → overlay light-leak (**chỉ gắn nếu asset `overlays/light_leak_<variant>.mp4` tồn tại**);
  `story_plan[].emphasis` (low/med/high) → **hệ số nhân duration theo từng act** (AI chọn enum,
  CODE tính giây — đúng Phụ lục A #3). Không có file nào → output y hệt cũ (Lite không đổi).
- ✅ `buildClip.mjs` (Lite) ép `--director none --plan none` để giữ tier Lite thuần rule-based
  kể cả khi file Phase B tồn tại trong `analysis/`.
- ✅ `fitTextInTimeline.mjs` chạy như cũ.
- ✅ **Đã verify**: `node --check` sạch; diff director-aware vs default cho thấy đúng curves/overlay/
  ending/duration đổi; **dry-run engine thật (`npm run render -- --dry-run`) PASS toàn bộ 16 slide**
  gồm bước "Applying 1 overlay(s)" cho light-leak — timeline đạo diễn hợp lệ qua validate+preflight.
  (Đã resync `analysis/photos.json` về 82 ảnh khớp `input/` — trước đó lệch 89 nên mọi timeline fail;
   đã `npm install` vì thiếu `node_modules`.)
  Giới hạn đã biết: layout là `layer_scene`/`film_roll` nên `easing` (chỉ hợp lệ cho zoom/pan/kenburns)
  và các `*Effect` hero/portrait/group của director CHƯA map vào template (template vẫn cứng);
  nâng cấp sau nếu cần chọn template theo effect đạo diễn.

### Phase D — Vòng lặp validate + fallback (node 9) — ✅ xong + 4 kịch bản đã verify
Orchestrator `scripts/renderWithRetry.mjs`: generate (director-aware) → dry-run validate →
gặp lỗi cụ thể thì **sửa cụ thể rồi retry** (giới hạn `--max-retries`, mặc định 2 = tối đa 3 lượt)
→ vẫn fail thì **fallback Lite (rule-based)** để khách vẫn có video. Tôn trọng exit code engine
(0 ok · 1 validate · 2 ffmpeg · 99). Trước vòng lặp `ensurePrereqs()` tự chạy analyzeMusic/
analyzePhotos nếu thiếu (không crash giữa chừng).
- ✅ Vì timeline do CODE sinh từ quyết định đã guardrail (Phase B ép enum), lỗi chạm engine là
  **cơ học/dữ liệu** chứ không phải enum bịa → fix **tất định** thay vì hỏi lại AI:
  (a) thiếu file ảnh → `prunePhotos` bỏ ảnh thiếu (+ ảnh không có trên đĩa) ghi `analysis/photos.pruned.json`
  rồi regen (thêm cờ `--photos` cho generator); (b) file director hỏng (enum sai do sửa tay vượt guardrail)
  → **bỏ tầng director, regen Lite**. (Nếu sau này có node để AI tự viết timeline thì chỗ này cắm
  re-prompt theo lỗi.) Lỗi asset không sửa được bằng prune (music/font/overlay/lut) → không prune, escalate.
- ✅ **4 kịch bản đã chạy thật (dry-run)**: (1) happy path → validate OK ngay (director); (2) 2 ảnh
  hero trỏ file không tồn tại → báo "image not found" → prune 2 → attempt 2 OK; (3) director_notes
  transition enum bịa → schema error → fallback Lite → OK; (4) `--music` sai → hard-fail **sạch** ở
  prereqs (exit 1, không stack trace). Generation error được bọc try/catch → luôn exit gọn.
- ✅ `buildClip.mjs` (Lite) vẫn tách biệt (ép `--director/--plan none`).

### Phase E — QA có proxy đo được (node 11) — ✅ xong (bookend chờ key) + 6 kịch bản đã verify
`scripts/qaProxy.mjs` (chỉ **đo** + đề xuất fix) và `scripts/qaLoop.mjs` (chỉ **áp** fix) tách đôi.
- ✅ Giữ nguyên lớp rule-based `qaClip.mjs` (too_dark/too_bright/flat), gọi lại trong `qaLoop`.
- ✅ **`scripts/lib/pacing.mjs` — 1 nguồn sự thật.** `sceneDur`/`xfadeDur`/energy dời ra khỏi
  `generateStoryClipV2` để generator **chọn** và QA **kiểm** trên đúng một đường cong (không drift,
  giống cách whitelist nạp từ `timeline.schema.json`). Refactor đã chứng minh giữ nguyên hành vi:
  5703 mẫu, 0 sai lệch; timeline Lite bất biến.
- ✅ **Pacing proxy — phép đo *độc lập*, không tự kiểm chính nó.** Generator lấy năng lượng tại
  **thời điểm bắt đầu** slide (`energy.at(t)`); QA lấy **trung bình năng lượng trên toàn khoảng**
  slide chiếm (`energy.meanOver`). Hai số lệch nhau khi nhạc đổi *dưới chân* slide, khi `emphasis`
  của story plan cãi nhạc, hoặc khi timeline bị sửa tay. Ngưỡng ±25% (hấp thụ được `emphasis`
  0.9–1.12 = ±12%). Montage (khóa theo nhịp) và slide kết (dài cố định) được miễn — montage lệch
  bar chỉ ghi *advisory*, không kích hoạt revise.
- ✅ **Hero-check** — dùng lại Hero Score node 2, **không chấm lại**. Gate theo
  `photo_content.generatedBy`: `stub` → **skip có lý do** (chỉnh ngưỡng trên điểm giả là vô nghĩa;
  schema để sẵn field này đúng cho quyết định đó). Chỉ flag khi **đề xuất được ảnh thay thế** cùng
  orient, chưa dùng, hơn ít nhất `--hero-margin` (0.15) → không sinh tiếng ồn.
- 🟡 **Bookend (mở đầu/kết yếu)** — điểm duy nhất thật sự cần AI vision. Phần **trích frame chạy
  thật** (ffmpeg lấy frame giữa slide đầu/cuối → `analysis/qa/frames/`); phần **chấm điểm** gate theo
  `hasKey()`. Không key → `skipped` kèm lý do, **không giả vờ pass**. Còn lại: cắm key + viết prompt chấm.
- ✅ **Trần cứng 2 revise** (`--max-revisions`, mặc định 2). Hết trần → **giao bản hiện tại +
  `manualReview`**, ghi `analysis/qa/<name>.loop.json`. Chống dao động bằng luật **sửa mỗi (cảnh,
  check) đúng 1 lần**: đổi duration 1 slide làm dịch start-time mọi slide sau → "sửa hết mỗi vòng"
  sẽ tự đuổi theo đuôi mình. Trần + sửa-một-lần khiến việc dừng là **thuộc tính cấu trúc**.
- ✅ **Pre-flight miễn phí**: pacing + hero **không cần video** → chạy trước render, sửa xong mới
  render, và **không tiêu tốn ngân sách revise**. Chỉ bookend + `qaClip` mới cần frame.
- ✅ Mọi phát hiện mang theo **fix tất định** (`set_duration` / `swap_hero`) — đúng lập luận node 9:
  timeline do CODE sinh từ enum đã guardrail nên lỗi là **cơ học**, code sửa nhanh và tái lập được;
  re-prompt model chính là thứ khiến QA thẩm mỹ lặp vô hạn.
- ✅ **Đã verify (chạy thật)**: (1) pacing bắt `too_slow_for_music` (slide 12s trên nhạc đòi 5.8s,
  +107%); (2) bắt `too_fast_for_music` (3s vs 6.2s, −52%); (3) **0 báo giả** trên 13 hero slot với
  điểm thật; (4) hero-check bắt `weak_hero` + đề xuất thay, và `hero_not_in_content` khi lệch dữ liệu;
  (5) cascade: 3 duration sai (kể cả slide rất sớm, 20s) → hội tụ trong **1 pass**, `verdict=ok`;
  (6) **render thật** 640×360: `--max-revisions 0` → giao ngay kèm 2 cờ; `--max-revisions 2` → đổi
  hero `082→010`, render lại, vẫn tối (do rect đen cố ý) → **hết fix tất định → giao kèm cờ, không lặp**.
  Bookend trích 2 frame 640×360 hợp lệ. `qaProxy --strict` exit 1 khi bẩn, 0 khi sạch.
- ✅ Timeline **không có nhạc** → pacing `skipped` có lý do, không đánh sập báo cáo (hero/bookend vẫn đo).

Dùng: `node scripts/qaProxy.mjs <timeline.json> [--strict]` (chỉ đo, không đụng file) ·
`node scripts/qaLoop.mjs --timeline <tl> [--max-revisions 2] [--skip-render]` (đo → sửa → render lại).

### Phase F — Giao hàng & điều phối (node 4, 12)
- ✅ **Deliverables** (node 12) — `scripts/deliver.mjs` + `schema/project-summary.schema.json`.
  Đóng gói `final.mp4` + `preview.mp4` + `thumbnail.jpg` + `project_summary.json` vào
  `output/deliver/<name>/`. **Node 12 đóng gói, KHÔNG render**: thiếu `output.path` → fail sạch
  kèm lệnh cần chạy (gộp "render nếu thiếu" vào lệnh đóng gói là cách một lệnh 1 giây âm thầm
  hóa thành 20 phút encode).
  - **Thumbnail — chọn frame và nói rõ luật nào đã chọn** (`thumbnail.chosenBy`). Dùng lại Hero
    Score node 2, **gate y hệt qaProxy**: `generatedBy: stub` → điểm là giả, chọn "cao nhất" chỉ là
    xếp hạng nhiễu mà trông có thẩm quyền → tụt về luật tất định. **Loại bookend ở CẢ hai nhánh**:
    slide đầu/cuối là bìa title/outro (đè chữ + fade), và slide kết **cố tình dài nhất** nên
    "longest hero slide" ngây thơ sẽ *luôn* nhặt đúng frame trắng xóa duy nhất của phim — đã quan
    sát thật rồi mới sửa. Hero Score chấm **tấm ảnh**, còn thumbnail là frame của **bản render**.
  - **`tier` không đoán.** Timeline không mang dấu vết provenance, và vân tay tầng director
    (curves/overlay) không đủ tin để suy ngược. Ai sinh timeline thì người đó truyền `--tier`;
    không có → `"unknown"` và **không đính** `director`/`storyPlan` vào summary (chỉ ghi `note`).
    Bản đầu tiên đã mắc đúng lỗi này: vơ `analysis/director_notes.json` vào một timeline demo
    không liên quan, khiến file khách đọc như thể video được chỉ đạo bởi nó.
  - **QA verdict phải TƯƠI.** Báo cáo QA đánh key theo **basename timeline**, mà `renderWithRetry`
    **ghi đè timeline tại chỗ** mỗi lần chạy → `<base>.proxy.json` của hôm qua nằm đúng chỗ của hôm
    nay và tả những slide không còn tồn tại. Bắt được khi chạy thật: summary đã báo `qa=review,
    problems=1` từ report sinh **trước timeline 13 tiếng**. Nay so `proxy.generatedAt` với mtime
    timeline; cũ hơn → `verdict: unknown` + chỉ đúng lệnh cần chạy lại (áp cho cả `.loop.json`).
    Bẫy: verdict tươi *tình cờ* cũng là `review/1` — nhìn con số thì không thấy lỗi.
  - `renderWithRetry --deliver` gọi node 12 với **tier của lượt thành công** (fallback có thể đã
    đổi director→lite giữa chừng — chỉ vòng lặp mới biết).
  - Preview: `-crf 26`, scale theo `--preview-height` (mặc định 720) và **không bao giờ upscale**;
    `--preview-seconds` cắt ngắn; `--watermark` dùng drawtext (font relative → tránh bẫy escape
    dấu `:` của ổ đĩa Windows trong filtergraph).
  - `project_summary.json` tự validate bằng `lib/checkSchema.mjs` trước khi ghi. **Bẫy**: harness
    kiểm `k in data`, nên key có giá trị `undefined` (vd `bitrateKbps` khi ffprobe trả `N/A`) vẫn
    bị walk và fail `type:number` → phải **bỏ hẳn key**, không set undefined.
  - ✅ **Đã verify (chạy thật)**: `renderWithRetry --deliver` đầu-cuối — generate → validate →
    render `quoc-nhi-full-v2.mp4` (115.2s, 1920×1080) → đóng gói, `tier=director` truyền đúng.
    Thêm 9 kịch bản — thiếu video → fail sạch; `--tier` sai → fail sạch;
    tier director → đính director+plan; tier lite/unknown → **không** đính, có `note`; content giả
    lập `vision:` → `chosenBy=heroScore` và thời điểm khớp `sceneTimes`; ép hero cao nhất vào slide
    kết → vẫn né bookend; `--thumb-time` → `explicit`; watermark tiếng Việt có dấu `:` và `&` →
    **kiểm bằng mắt trên frame trích ra**, chữ vẽ đúng; `--preview-height 2000` trên nguồn 1080p →
    không upscale; `--no-copy` → summary trỏ về video gốc. Mọi summary pass schema harness.
- ⬜ **User Choice** (node 4): gửi 4 option qua kênh khách (Zalo/Messenger), cửa sổ 24h
  **non-blocking**; hết giờ → tự chọn phương án điểm cao nhất.
- ⬜ **Orchestration**: n8n/queue gọi CLI (mỗi job timeline+output riêng, chạy song song).
  Ranh giới: điều phối chỉ gọi engine, không sinh FFmpeg. Xem
  [PIPELINE-V1-VA-LITE.md → Orchestration](PIPELINE-V1-VA-LITE.md#orchestration--triển-khai).

Dùng: `node scripts/deliver.mjs <timeline.json> [--tier director|lite] [--out-dir <dir>]
[--preview-height 720] [--preview-seconds 0] [--watermark "text"] [--thumb-time <sec>] [--no-copy]`

---

## 4. Backlog nâng cấp engine (tùy chọn, không chặn v1)

- ⬜ Face/subject detection thật cho crop-safe `cover` (nay chỉ theo tỉ lệ).
- ⬜ QA bằng vision (đo chính xác chữ vừa khung, crop chủ thể, overlap nghệ thuật).
- ⬜ Easing cho `layer_scene` `motion` (whole-slide effect đã có `gentle/snap/bounce`).
- ⬜ Keyframe/mask reveal per-layer, photo-stack shuffle.

---

## 5. Cách dùng bảng này

- Xong một ⬜ → đổi thành ✅ và cập nhật ngày ở đầu file.
- Thêm việc mới phát sinh vào đúng phase.
- Khi một phase xong hết → chuyển dòng tương ứng ở §1 sang ✅ và ghi 1 dòng vào §2.
