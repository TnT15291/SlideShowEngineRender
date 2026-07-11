# Trạng thái hiện tại & kế hoạch

> Tài liệu **sống** — cập nhật mỗi khi xong một bước. Cập nhật cuối: **2026-07-11** (tier template
> recipe-driven + 4 recipe render verified; engine thêm `flicker`, LUT bundle, `mask_reveal` +
> 3 mask: hạt sáng / `heart_wand` / `brush_stroke` — giai đoạn 1–3 lộ trình hiệu ứng §4b XONG).
>
> Legend: ✅ xong · 🟡 một phần · ⬜ chưa làm

Bảng này theo dõi khoảng cách giữa **thiết kế** ([PIPELINE-V1-VA-LITE.md](PIPELINE-V1-VA-LITE.md))
và **hiện trạng code**. Số node dưới đây trỏ tới node trong tài liệu pipeline đó.

---

## 1. Tổng quan

| Tầng | Trạng thái | Ghi chú |
|---|---|---|
| **Render engine** | ✅ Feature-complete | **24 effect** (+`mask_reveal`), 56 transition, color grade (+`flicker`, LUT bundle), overlay + light leak + film damage, audio graph, easing. Xem [NANG-LUC-ENGINE.md](NANG-LUC-ENGINE.md) |
| **Tier template (Rẻ)** | ✅ Recipe-driven, 4 recipe verified | `applyStoryTemplate.mjs` đọc geometry từ `layouts/library.json` — **thêm template = 1 file JSON, 0 code**. 4 recipe render thật + soi mắt |
| **Pipeline Lite** (Cơ bản/Vừa) | ✅ Chạy end-to-end | `node scripts/buildClip.mjs --fix` — rule-based, 0 AI |
| **Pipeline v1 Premium** | 🟡 A→E xong, F một phần | Node 2 (vision) wired **OpenAI gpt-5.5**, node 3/5+6/7 (story/brief/director/plan) wired **DeepSeek**, cả hai có guardrail; timeline node (8) bám director & PASS dry-run; node 9 `renderWithRetry.mjs` validate→retry→fallback Lite; node 11 `qaProxy.mjs` + `qaLoop.mjs` (pacing/hero proxy, trần 2 revise); node 4 `selectStoryOption.mjs` (cửa sổ phản hồi cưỡng chế, exit 3 = pending); node 12 `deliver.mjs` đóng gói 4 deliverable; `runPremiumJob.mjs` gom node 2→12. Còn điều phối production (n8n/queue) |
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
- ✅ **Node 4 — User Choice** `scripts/selectStoryOption.mjs` (chi tiết ở §3, Phase F). Cửa sổ phản
  hồi được **cưỡng chế**, không phải ghi chú: `auto` khi còn hạn → exit 3 (non-blocking, không phải
  lỗi); trả lời của khách không bị mặc định đè; kênh chưa cấu hình **từ chối gửi** thay vì nuốt tin.
  Cùng nguyên tắc với node 12: **không tuyên bố điều pipeline chưa từng làm** — không bịa cửa sổ
  24h cho một lần chạy chẳng hỏi ai.

**Bổ sung phiên 2026-07-10→11 (tier template + hiệu ứng mới):**
- ✅ **Chiến lược tier đã chốt**: 4 phương án (template / rules / AI-tự-sinh-timeline / Premium-AI-gợi-ý)
  KHÔNG phải 4 sản phẩm — là **thang giá trên cùng 1 engine**. "AI tự đẻ timeline thô" là bẫy →
  chỉ là mode auto-pick của Premium. Tier Rẻ cần **~5-8 recipe, KHÔNG phải 100-200 timeline viết tay**
  (đa dạng = recipe × theme × ảnh × nhạc).
- ✅ **Refactor `applyStoryTemplate.mjs` thành data-driven**: `buildLayerSceneFromLayout` đọc toàn bộ
  geometry từ `layouts/library.json`; scene trong recipe chỉ khai `layout` id + `photoSlots` (hint
  chọn ảnh, slot id phải khớp library) + `text` map (nhận string hoặc `{value,sizePx,color,fontRole}`).
  Resolver: token màu theme (`theme.cream_bg`), fontRole→font, frame preset, **màu chữ theo luma**
  (trên scrim tối → trắng), stagger, panel `z:"over_photos"` (scrim vẽ SAU ảnh), `frameOverlay`
  (PNG 1920×1080 phủ khung). Builder cũng nhận mọi effect đơn-ảnh + `double_exposure` +
  `video_background` + `mask_reveal` — recipe gọi được không cần code.
- ✅ **5 theme mới** trong `layouts/library.json`: `editorial_bold`, `warm_film`, `modern_teal`
  (trend 2026: serif đậm "cursive out", vintage film, Transformative Teal) + `teal_orange_editorial`,
  `super8_nostalgia` (LUT-based). Layout `hero_title_card` được vá `date_scrim` (đen 0.3, z over_photos)
  + hộp date 436→240px — hết lỗi chữ chìm trên ảnh sáng.
- ✅ **4 recipe** trong `story-templates/` — cấu trúc cố tình KHÁC nhau (không chỉ đổi màu):
  `editorial-bold-01` (card-heavy + portrait_blur), `cinematic-film-01` (mở lạnh không chữ →
  double_exposure → film_roll_up; overlay particles; KHÔNG layout card), `warm-film-01` (scrapbook:
  polaroid + video hoa calla thật + frame botanical PNG + bokeh vàng), `modern-teal-01` (tối giản
  8 scene, circle_focus + slow_zoom gentle, 3 beat im lặng, 0 overlay). **Cả 4 render thật + soi
  khung hình.** Job mẫu `jobs/i-do-editorial/` (ảnh lọc nét ≥0.45/28 → `analysis/photos.selected.json`,
  nhạc "Em Đồng Ý (I Do)" đã analyze, 3 caption) → `output/i-do-editorial.mp4` 55.4s.
- ⚠️ **`story-templates/korean-soft-romance-01.json` bị xóa khỏi working tree** — không phải phiên
  này xóa (nghi session song song). Bản trong git là bản CŨ chưa rebind layout → `git checkout` sẽ
  không chạy được với builder mới (thiếu field `layout`). Chưa khôi phục — chờ quyết định.
- ✅ **`checkSchema.mjs` thêm hỗ trợ `const`** — trước đó text layer khớp cả 2 nhánh `oneOf`
  ("matched 2") khi validate timeline. Additive, không phá contract cũ.
- ✅ **Lộ trình hiệu ứng** (từ `Downloads/hieu-ung-slideshow-cuoi.md`, xem §4b): **Giai đoạn 1 + 2
  + 3 XONG** (`heart_wand` + `brush_stroke` — cả nhóm mask hoàn tất).
- ✅ **Giai đoạn 1 — LUT + Super 8**: engine thêm `color.flicker` 0..1 (eq `eval=frame`, sin 9Hz +
  jitter, amp≤0.08; chèn trước grain). **Gotcha đảo chiều**: `normalizeTimeline` pass-through nguyên
  khối `color` → field grade mới chỉ cần 4 điểm chạm (types/zod/build/schema), KHÔNG cần normalize.
  `scripts/generateLuts.mjs` → `assets/luts/{teal_orange_01,moody_earth_01,super8_kodak_01}.cube`
  (procedural 33³). `scripts/generateFilmDamage.mjs` → `overlays/film_damage.mp4` (bụi loé/frame +
  2 vệt xước lang thang, 241KB loop). Verify A/B: 1 ảnh × 3 LUT khác biệt rõ; flicker xác nhận qua
  `logs/commands.log` (lệnh slide ghi ở đó, `render.log` chỉ là stderr) + demo `output/demo-super8.mp4`.
- ✅ **Giai đoạn 2 — effect `mask_reveal`** (đủ 7 điểm chạm engine): slide nhận `image` + `mask`
  (video xám: trắng=lộ ảnh); mask chạy 1 lần rồi `tpad stop_mode=clone` giữ khung trắng cuối →
  slide dài hơn mask vẫn đứng ảnh hoàn chỉnh; `alphamerge` trên nền đen; grade/letterbox/caption
  chạy sau composite. KHÔNG nằm trong CROPPING_EFFECTS (không bị reroute portrait).
  `scripts/generateMasks.mjs` → `assets/masks/particle_gather.mp4` ("hạt sáng tích tụ": 700 hạt
  mọc từ tâm lan ra + sparkle 3-frame + fill ramp 72–96% đảm bảo lộ hết; seed cố định). Verify:
  YAVG đơn điệu 1.3→22→70→152 + 4 khung soi mắt (`output/demo-particle-reveal.mp4`).
  **"Đũa phép trái tim" & "bàn chải sơn" giờ chỉ là generator mask mới — 0 code engine.**
  Library có montageBeat `particle_reveal` (khuyến cáo ≤1 lần/video).
- ✅ **Giai đoạn 3 (một nửa) — mask `heart_wand`** ("đũa phép quơ hình trái tim"): đũa vẽ đường tim
  parametric cổ điển (nét phát sáng + sparkle đầu đũa, ease-in-out), tim "nở" đầy từ tâm bằng
  radial wipe **clip theo scanline-fill chính xác của hình tim** — KHÔNG scale đường cong từ tâm,
  vì thuỳ tim thu nhỏ sẽ quét qua khe giữa 2 thuỳ làm khe bị trắng sai — rồi lan toả tròn ra toàn
  khung + ramp bảo đảm 88–98%. 5.0s, seed cố định. Verify: YAVG đơn điệu 16.3→40.9→68.3→230
  (yuv limited-range: đen=16, trắng=235) + 6 khung mask soi mắt (khe giữa 2 thuỳ vẫn đen khi tim
  đầy) + demo ảnh thật `output/demo-heart-reveal.mp4` (timeline `tmp/demo-heart-reveal.json`).
  Library beat `heart_reveal` (≤1 lần/video, không dùng chung với `particle_reveal`).
- ✅ **Giai đoạn 3 (nửa còn lại) — mask `brush_stroke`** ("bàn chải sơn"): 5 nhát cọ ngang xen kẽ
  chiều quét (như sơn tường), texture sống ở 3 chỗ: rìa dải 2 octave, **vệt cọ khô** mảnh-dài
  (noise kéo dãn 160×2, ngưỡng cao → thưa), và "lông cọ" dẫn trước đầu quét (lead profile theo
  hàng, cố định suốt nhát — như lông thật trên bàn chải). Dải đầu/cuối sơn vượt mép khung để tự
  phủ góc, không đợi ramp. **Bài học đắt**: noise sin-cộng-dồn tuần hoàn nhìn như RÈM CỬA — mask
  toàn khung bắt buộc dùng value-noise băm lưới (aperiodic); bản 2 (cell 85×4.5, ngưỡng 0.62)
  thành đốm bầu dục như giấy rách — phải mảnh (cy=2) + thưa (0.78/0.08). Verify: YAVG đơn điệu
  16→230→235 + 4 khung mask + demo ảnh thật `output/demo-brush-reveal.mp4`. Library beat
  `brush_reveal`. **Giai đoạn 3 XONG — cả nhóm mask khép lại, đúng dự đoán 0 code engine.**

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
- ✅ **Chuẩn bị cho lần chạy có key (2026-07-10)** — node này là node **duy nhất** có chi phí tỉ lệ
  với số ảnh, nên lần chạy thật đầu tiên vừa đắt nhất vừa là lần prompt chưa từng gặp model thật.
  - `--dry-run`: mã hóa đủ 82 preview để **đo payload thật**, in endpoint/model/nhánh body
    (`reasoning_effort` vs `temperature`), số request, dung lượng base64, và **số ảnh không đọc
    được** (model sẽ nhận `"(image unreadable)"` và chấm mù). Không gửi gì, không ghi gì.
    Đo thật: 82 ảnh → 7 request, 3.9 MB base64, request lớn nhất 663 KB, 82/82 đọc được.
  - `--limit N`: chấm N ảnh đầu rồi **in bảng tag/emotion/score ra terminal** để soi bằng mắt.
    Bản rút gọn **không được phép giả dạng bản đầy đủ**: nó ghi ra `analysis/photo_content.sample.json`
    và **từ chối** khi `--out` trỏ vào `photo_content.json` — 12 record ở chỗ pipeline chờ 82 sẽ
    lệch story profile và mọi hero pick mà không để lại dấu vết (đúng loại lỗi silent-zeros 2026-07-09).
    File sample mang `partial/limitedTo/totalPhotos` (schema đã mở rộng, optional).
  - Lỗi provider giờ **fail sạch, không stack trace**: 401/403 → "sai KEY"; 400 → "sai BODY, không
    phải key" kèm nhắc đúng bẫy `temperature` vs `reasoning_effort`; 429/5xx → "vẫn hỏng sau 3 lần".
- 🐛 **Sửa bug retry 4xx (2026-07-10)** — `lib/deepseek.mjs` **và** `analyzePhotoContent.mjs` đều viết
  `throw lastErr` **bên trong** `try` để nói "lỗi client, đừng thử lại"; chính `catch` bên dưới nuốt nó
  và vòng lặp chạy tiếp. Key sai tốn **3 request giống hệt nhau** thay vì 1. Hai bản sao, một lỗi.
  Policy dời về `scripts/lib/retryPolicy.mjs` (1 nguồn sự thật) + backoff tuyến tính 500ms×attempt.
  Verify bằng mock server đếm request: 401/400 → **1 request**; 429/5xx → 3; 200 → 1. Cho cả hai client.
- 🟡 **Còn lại**: chạy thật bằng key OpenAI. Thứ tự an toàn:
  `--dry-run` → `--limit 12` (soi tag) → chạy đủ 82 ảnh.

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
- ✅ **User Choice** (node 4) — `scripts/selectStoryOption.mjs` + `schema/selected-story.schema.json`
  + `scripts/lib/channels.mjs`. `generateDirectorNotes` ưu tiên `analysis/selected_story.json` nếu
  không có `--choice`. **Cửa sổ phản hồi là cổng thật, không phải ghi chú trong file:**
  - `--send` mở cửa sổ bằng cách **gửi thật**. Kênh chưa có transport (`zalo`/`messenger`) →
    **ném lỗi**, không trả về `send()` rỗng: một tin nhắn âm thầm đi vào hư không còn tệ hơn crash —
    cửa sổ 24h vẫn hết hạn, luật mặc định vẫn nổ, và phim vẫn giao dưới một lựa chọn **chưa từng
    được đưa ra cho ai**. Kênh thật hiện có: `console` (người relay tay) và `file` (outbox/inbox).
  - **Deadline được cưỡng chế.** `--choice auto` khi cửa sổ còn mở → **exit 3** = "chưa sẵn sàng",
    không phải lỗi; orchestrator gác job sang bên và làm việc khác. Đây là hợp đồng non-blocking.
  - **Trả lời của khách không bao giờ bị đè** bởi mặc định timeout (idempotent), và trả lời **muộn**
    được ghi `late: true` chứ không backdate.
  - **Không đoán câu trả lời.** `parseReply` chỉ nhận chữ cái **đứng riêng** (`Tôi chọn C.` → C;
    `Cảm ơn`/`Anh`/`các` → không khớp). Mơ hồ (`A hay B?`) → giữ pending cho người xem, vì đoán ở
    đây là giao nhầm phim. `--choice X` mâu thuẫn với reply → fail cứng.
  - ⚠️ **Cửa sổ 0 giờ.** Không ai được hỏi (chạy local một phát) → mặc định ngay, **nhưng ghi
    `decisionWindow` dài 0h**. Bản đầu ghi `openedAt: now, deadlineAt: now+24h` rồi chốt tức thì —
    tuyên bố một hạn chót chưa từng được trao và chưa từng được chờ. Lỗi không nằm ở việc mặc định
    sớm, mà ở việc **bịa ra cửa sổ**.
  - ❌ **Không** implement luật "chấm điểm 4 hướng bằng Story Importance/Emotion Score của node 2"
    như spec §3 gợi ý: 4 option là văn xuôi (`mood`, `captionTone`), chấm chúng bằng số đòi một bảng
    ánh xạ mood→điểm tự bịa, không ai kiểm chứng được — và khi `generatedBy: stub` thì điểm cũng
    giả nốt. Mặc định dùng `story_options.recommended` (thứ hạng best-fit-first của node 3), và
    `reason` luôn ghi rõ luật nào đã quyết.
  - ✅ **Đã verify (chạy thật)**: auto khi cửa sổ mở → exit 3, không ghi file; auto khi chưa ai hỏi →
    exit 0 + cửa sổ 0h; trả lời muộn → `late: true`; auto sau khi khách chọn → không đè; reply mơ hồ
    → pending; reply vô nghĩa sau deadline → mặc định + giữ nguyên `reply`; `--opened-at` tương lai →
    exit 3, quá khứ → exit 0; kênh `zalo` → từ chối; re-send khi đang mở → từ chối; và
    `Tôi chọn C` → `selected_story` C → `director_notes.choice = C`.
- ✅ **Orchestration CLI nền**: `scripts/runPremiumJob.mjs` gom node 2→12 thành một lệnh local:
  analysis → story options → node 4 selection → director notes → story plan → validate/fallback →
  render+QA → deliver tuỳ cờ. Ranh giới vẫn giữ: điều phối chỉ gọi node/engine, không sinh FFmpeg.
- ⬜ **Orchestration production**: n8n/queue gọi CLI (mỗi job timeline+output riêng, chạy song song).
  Xem
  [PIPELINE-V1-VA-LITE.md → Orchestration](PIPELINE-V1-VA-LITE.md#orchestration--triển-khai).

Dùng: `node scripts/deliver.mjs <timeline.json> [--tier director|lite] [--out-dir <dir>]
[--preview-height 720] [--preview-seconds 0] [--watermark "text"] [--thumb-time <sec>] [--no-copy]`

---

## 4. Backlog nâng cấp engine (tùy chọn, không chặn v1)

- ⬜ Face/subject detection thật cho crop-safe `cover` (nay chỉ theo tỉ lệ).
- ⬜ QA bằng vision (đo chính xác chữ vừa khung, crop chủ thể, overlap nghệ thuật).
- ⬜ Easing cho `layer_scene` `motion` (whole-slide effect đã có `gentle/snap/bounce`).
- ⬜ Keyframe reveal **per-layer**, photo-stack shuffle (`mask_reveal` whole-slide đã có — §4b).
- ⬜ Tier template: cơ chế **scale theo input** (recipe khai `repeatable` scene → nhân theo số
  ảnh/độ dài nhạc; hiện video luôn ~1 phút dù 200 ảnh + nhạc 203s).
- ⬜ Tier template: tiêu thụ `photo_content.json` khi có (match slot theo tag family/couple thay vì
  chỉ orient/quality — scene "Gia đình" hiện có thể nhận ảnh couple selfie).
- ⬜ Recipe copy: 2–3 biến thể câu chữ mỗi scene (2 khách cùng mua 1 template không nhận video
  giống hệt câu chữ).

## 4b. Lộ trình hiệu ứng (nguồn: `Downloads/hieu-ung-slideshow-cuoi.md`)

Nguyên tắc đã chốt: nhóm mask (đũa phép tim / bàn chải sơn / hạt sáng) = **MỘT effect `mask_reveal`
+ nhiều asset mask**; grade look = LUT asset, không code; hiệu ứng AI = node tiền xử lý, không phải
filter engine.

| # | Hiệu ứng | Trạng thái | Ghi chú |
|---|---|---|---|
| 4 | Super 8 / Nostalgic film | ✅ | LUT `super8_kodak_01` + `flicker` + `film_damage.mp4` + theme `super8_nostalgia`. Demo: `output/demo-super8.mp4` |
| 6 | Teal-orange / moody | ✅ | `assets/luts/` 3 file + theme `teal_orange_editorial`. Demo A/B: `output/test-luts.mp4` |
| 3 | Hạt sáng tích tụ | ✅ | `mask_reveal` + `assets/masks/particle_gather.mp4`. Demo: `output/demo-particle-reveal.mp4` |
| 1 | Đũa phép quơ hình trái tim | ✅ | `mask_reveal` + `assets/masks/heart_wand.mp4` (generator `heart_wand`, 0 code engine — đúng như dự đoán). Library beat `heart_reveal`. Demo: `output/demo-heart-reveal.mp4` |
| 2 | Bàn chải sơn | ✅ | `mask_reveal` + `assets/masks/brush_stroke.mp4` (generator `brush_stroke`, 0 code engine). Library beat `brush_reveal`. Demo: `output/demo-brush-reveal.mp4` |
| 7 | Tilt-shift | ⬜ | Field grade mới `tiltShift` (split→gblur→trộn gradient dọc); nhớ: color field mới chỉ cần 4 điểm chạm |
| 5 | Speed ramping | ⬜ | ĐÍNH CHÍNH file gốc: cần **video-clip slide** trước (engine hiện render ảnh tĩnh; easing gentle/snap/bounce đã cover "nhanh chậm theo cảm xúc" cho ảnh) |
| 8–10 | Neural relight / Gen expand / extend | ⬜ | Node tiền xử lý gọi API ngoài (ảnh vào→ảnh ra), engine core không đổi. Chờ giai đoạn Kling/Seedance |

---

## 5. Cách dùng bảng này

- Xong một ⬜ → đổi thành ✅ và cập nhật ngày ở đầu file.
- Thêm việc mới phát sinh vào đúng phase.
- Khi một phase xong hết → chuyển dòng tương ứng ở §1 sang ✅ và ghi 1 dòng vào §2.
