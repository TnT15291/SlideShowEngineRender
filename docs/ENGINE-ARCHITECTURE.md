# Kiến trúc Render Engine

Engine đọc `timeline.json`, validate, rồi biến nó thành MP4 qua FFmpeg. Không phụ thuộc
GPT/Claude/n8n lúc render — mọi thứ chạy local, deterministic, log đầy đủ.

(Tài liệu này thay thế bộ cũ `02-architecture` / `04-render-engine-spec` /
`05-ffmpeg-rendering-rules` — vốn viết cho giai đoạn xây engine từ đầu, nay đã xong.)

## Pipeline thực thi (`src/index.ts`)

```text
timeline.json
  → readJson                 đọc + parse JSON
  → normalizeTimeline        alias → tên chuẩn, điền default, gộp field legacy
  → validateTimeline         Zod cấu trúc + ngữ nghĩa (id trùng, file tồn tại, ràng buộc chéo)
  → applyFaceSafeFraming     layer_scene: cover → contain khi nguy cơ cắt mặt cao
  → preflightTimeline        báo cáo trước render: đếm asset, ước tính thời lượng, cảnh báo
  → preprocessTimelineImages ảnh quá lớn → thu nhỏ vào temp/image-cache (không sửa gốc)
  → compileTimeline          dựng RenderPlan: path tuyệt đối, caption/text ra file UTF-8
  → renderSlides             mỗi slide → 1 video tạm trong temp/
  → renderFinal              ghép transition (xfade) → overlay → mux nhạc → output cuối
```

Render **từng slide riêng** trước khi ghép: dễ debug (biết slide nào lỗi), preview được
từng slide, và khi mọi transition là `none` thì ghép bằng stream-copy (không re-encode).

## Cấu trúc thư mục

```text
SlideshowRenderEngine/
├─ input/          ảnh nguồn (jpg/png)
├─ music/          nhạc nền
├─ timeline/       các timeline.json (kèm ví dụ/test đã giữ lại)
├─ output/         video cuối
├─ temp/           video slide tạm + image-cache + file text caption
├─ logs/           commands.log (mọi lệnh ffmpeg) + render.log (stderr, sự kiện)
├─ fonts/          10 font cưới đã kiểm tra dấu tiếng Việt (xem ASSETS.md)
├─ overlays/       asset overlay đóng gói: particles + 3 light leak procedural
├─ assets/         backgrounds / overlays mixkit / frames / licenses (xem ASSETS.md)
├─ schema/         timeline.schema.json — JSON Schema phản chiếu validate
├─ layouts/        library.json — layout + design token cho AI Director
├─ analysis/       output của analyzePhotos/analyzeMusic/qaClip
├─ scripts/        pipeline Lite + tiện ích (xem bảng dưới)
└─ src/            engine TypeScript
```

## Trách nhiệm module (`src/`)

| Module | Vai trò |
|---|---|
| `index.ts` | CLI entry, nối các bước pipeline, exit code |
| `types.ts` | **Source of truth** cho enum/field: `EffectPreset`, `XFADE_BY_TRANSITION` (56 transition), `MOTION_EASINGS`, `LIGHT_LEAK_VARIANTS`, mọi interface timeline |
| `normalizeTimeline.ts` | Alias thân thiện → tên chuẩn (`zoom in`→`slow_zoom_in`, `fade`→`crossfade`), default (opacity, blend, easing, variant light-leak → path asset), gộp legacy (`caption` đơn → `captions[]`, `music` object → mảng) |
| `validateTimeline.ts` | Zod schema + kiểm tra ngữ nghĩa: id duy nhất, file tồn tại, ràng buộc chéo (transition < duration, caption/layer trong slide, easing đúng nhóm effect, overlay path xor variant) |
| `faceSafeFraming.ts` | Layer ảnh `cover` có crop-loss > `FACE_SAFE_MAX_CROP_LOSS` (0.18) → `contain`; có `focusX/focusY` thì giữ cover |
| `preflightTimeline.ts` | Báo cáo trước render + cảnh báo tràn chữ, media hỏng, layer vượt khung (chặn bleed ngoài canvas) |
| `preprocessImages.ts` / `imageSize.ts` | Đọc kích thước ảnh; thu nhỏ ảnh > `IMAGE_CACHE_MAX_EDGE` (2560px) vào `temp/image-cache` |
| `compileTimeline.ts` | Timeline → RenderPlan: path tuyệt đối, merge color global+slide, auto-route ảnh lệch tỉ lệ → `portrait_blur_background` (crop-loss > 0.3 so với khung **dự án**), caption/text → file UTF-8 cho drawtext |
| `buildFfmpegCommand.ts` | **Chỉ nơi này sinh lệnh FFmpeg.** Thuần hàm: RenderStep → mảng args (spawn, không shell string). Effect filter, easing curve, xfade chain, overlay/blend, audio graph |
| `renderSlide.ts` | Chạy ffmpeg render từng slide ra `temp/` |
| `renderFinal.ts` | Ghép (concat/xfade) → overlay pass → audio mux → output; tính lại tổng thời lượng sau overlap transition để cắt nhạc khớp |
| `quality.ts` | 4 preset chất lượng (draft/share/high/master → x264 preset + CRF + bitrate audio) |
| `fileUtils.ts` | Tìm ffmpeg (`FFMPEG_PATH` → ffmpeg-static → PATH), Logger, probe duration, lỗi có phân loại (`ValidationError`/`FfmpegError`) |
| `generateTimeline.ts` | `npm run gen` — generator theo orientation ảnh (xem NANG-LUC-ENGINE.md §14) |

Scripts pipeline (`scripts/`): `analyzePhotos.mjs`, `analyzeMusic.mjs`,
`generateStoryClipV2.mjs`, `applyStoryTemplate.mjs`, `fitTextInTimeline.mjs`, `qaClip.mjs`,
`runProject.mjs` (orchestrator duy nhất, 3 tier), `generateLightLeaks.mjs` (tái tạo asset
light-leak). Chi tiết: NANG-LUC-ENGINE.md §15 và [PROJECTS.md](PROJECTS.md).

## CLI & exit code

```bash
npm run render -- --timeline timeline/timeline.json   # render
npm run render -- --timeline ... --dry-run            # validate + in lệnh, không render
npm run gen -- [cờ]                                   # sinh timeline từ input/
npm run typecheck
```

| Exit code | Ý nghĩa |
|---|---|
| `0` | thành công |
| `1` | lỗi validate (timeline sai — sửa JSON) |
| `2` | lỗi FFmpeg (xem `logs/render.log`) |
| `99` | lỗi không xác định |

Quy ước này là hợp đồng cho tầng điều phối (n8n/API sau này): mã `1` trả lỗi cho
AI sửa timeline; mã `2` là lỗi hạ tầng, retry không cần đổi JSON.

## Logging & debug

- `logs/commands.log` — **mọi** lệnh ffmpeg đã chạy (kể cả `--dry-run`), copy-paste
  chạy lại được.
- `logs/render.log` — sự kiện + stderr đầy đủ của từng bước, gắn nhãn theo slide id.
- Lỗi phải chỉ đích danh: slide id, file ảnh, lệnh, stderr — không bao giờ "FFmpeg failed" trần.
- Debug một slide: lấy lệnh của nó trong `commands.log`, chạy tay, xem `temp/<slideId>.mp4`.
- Test tăng dần: 3 ảnh → 10 → 30 → 100 (kiểm output chạy được, nhạc khớp, transition
  mượt, ảnh dọc đẹp, log dễ đọc).

## Quy tắc render FFmpeg

**Encode mặc định** (mọi preset chất lượng): `libx264`, `yuv420p`, `aac`,
`+faststart`, container MP4. Resolution/fps theo `project` (khuyến nghị 1920×1080@30).

**Motion tuning** (hằng số trong `buildFfmpegCommand.ts`):

- `ZOOM_MAX = 1.12` — zoom-in kết thúc / zoom-out bắt đầu tại đây.
- `PAN_ZOOM = 1.12` — pan giữ mức zoom này để có slack di chuyển ngang/dọc.
- zoompan chạy trên canvas oversample 2× để chống giật crop số nguyên.
- Chuyển động mặc định eased **smoothstep** t²(3−2t) — không bao giờ tuyến tính.
  Slide có thể đổi curve bằng `easing: gentle | snap | bounce` (chỉ nhóm
  zoom/pan/kenburns; chi tiết NANG-LUC-ENGINE.md).

**Xử lý ảnh dọc / lệch tỉ lệ**: effect crop (still/zoom/pan/kenburns) áp lên ảnh có
cover-crop-loss > 30% so với khung dự án sẽ tự route sang `portrait_blur_background`
(nền là chính ảnh đó blur phủ khung, ảnh chính fit không cắt người). So với khung
**dự án** chứ không phải "ảnh dọc" — project 9:16 tự xử lý đúng với ảnh ngang.

**Gotcha quoting đã kiểm chứng** (giữ nguyên khi sửa builder):

- Path Windows trong filtergraph cần **cả** nháy đơn **và** escape dấu hai chấm:
  `fontfile='C\:/...'`.
- Expression có dấu phẩy (zoompan, geq) phải bọc nháy đơn.
- `blend` (screen/addition) yêu cầu 2 input **cùng** planar RGB (`format=gbrp`)
  rồi convert lại `yuv420p` — trộn rgba với yuv sẽ ám magenta cả khung.
- `sidechaincompress`/`amix` dừng ở input **ngắn nhất** — voiceover phải
  `apad=whole_dur=<videoDur>` nếu không nhạc chết khi voice hết.

## Biến môi trường

| Env | Mặc định | Ý nghĩa |
|---|---|---|
| `FFMPEG_PATH` | (ffmpeg-static) | đường dẫn ffmpeg |
| `IMAGE_CACHE_MAX_EDGE` | `2560` | cạnh dài tối đa trước khi thu nhỏ vào cache; `0` = tắt |
| `FACE_SAFE_MAX_CROP_LOSS` | `0.18` | ngưỡng đổi cover→contain cho layer ảnh; `0` = tắt |
| `CAPTION_FONT` | Arial hệ thống | font caption mặc định |

## Tầng API (chưa xây)

CLI là hợp đồng ổn định hiện tại. Khi cần, bọc thành API
(`POST /render` body timeline.json → jobId) mà không đổi engine — n8n/orchestrator
chỉ gọi CLI/API, không bao giờ tự sinh lệnh FFmpeg (xem PIPELINE-V1-VA-LITE.md).
