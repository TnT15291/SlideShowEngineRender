# Tài liệu — Wedding Render Engine

Dự án AI Wedding Slideshow gồm 2 tầng:

1. **Render engine local** (Node/TypeScript + FFmpeg) — **đã hoàn thiện tính năng**:
   đọc `timeline.json` + ảnh + nhạc → `output/final.mp4`.
2. **Pipeline sản xuất 3 tier** phía trên engine — Template (recipe, 0 AI), Lite (rule-based)
   và Premium (AI đạo diễn, có cổng khách chọn story + cách dùng bài nhạc).

## Trạng thái (2026-07-13)

- **Engine**: 29 effect ảnh, 56 transition, caption tiếng Việt, color grading đầy đủ,
  overlay (kèm 3 light-leak đóng gói sẵn), audio graph (playlist/automation/ducking),
  easing chuyển động (`gentle`/`snap`/`bounce`), validate → preflight → face-safe →
  image-cache → render → QA.
- **Pipeline**: một orchestrator, ba tier — `npm run template|lite|premium -- --project <p>`
  (analyze → plan → build → render → QA → deliver, mỗi job một thư mục riêng).
  Xem [PROJECTS.md](PROJECTS.md).
- **v1 Premium**: toàn bộ node đã nối vào orchestrator và chạy end-to-end bằng STUB khi thiếu key;
  còn smoke test với API key thật và orchestration production. Pipeline pause bằng `exit 3` khi đang
  chờ khách chọn story hoặc chọn highlight/full song.
- **Kiểm thử**: `npm run check` chạy typecheck core + GPU, unit test nhanh và integration pipeline
  dry-run → render → resume → QA → deliver. Regression album/media cục bộ chạy riêng bằng
  `npm run test:regression`.

## Triết lý

```text
AI → Quyết định · timeline.json → Hợp đồng · Engine → Thực thi · FFmpeg → Render
```

AI không sinh lệnh FFmpeg, không bịa tên effect — chỉ chọn preset trong whitelist và
sắp xếp chúng theo câu chuyện. Engine validate mọi thứ trước khi render. `timeline.json`
không phải tác phẩm sáng tạo; nó là **ngôn ngữ kỹ thuật** chuyển quyết định của
"đạo diễn" thành phim hoàn chỉnh.

## Bản đồ tài liệu

| Bạn cần | Đọc |
|---|---|
| **Trạng thái hiện tại + kế hoạch còn lại** (bảng theo dõi sống) | [current-state.md](current-state.md) |
| Pipeline sản phẩm 2 tier: node, giá, SLA, guardrail AI, hiện trạng | [PIPELINE-V1-VA-LITE.md](PIPELINE-V1-VA-LITE.md) |
| Engine chạy thế nào: module, CLI, exit code, log, debug, env | [ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md) |
| Tra cứu năng lực + spec `timeline.json` đầy đủ (tiếng Việt) | [NANG-LUC-ENGINE.md](NANG-LUC-ENGINE.md) |
| Contract tiếng Anh cho AI viết timeline JSON | [ENGINE_CAPABILITIES.md](ENGINE_CAPABILITIES.md) |
| Brief "AI Director" — sinh timeline giàu cảm xúc đúng schema | [generation-guide.md](generation-guide.md) |
| Danh mục asset local + catalog `analysis/assets_catalog.*.json` cho AI Director | [ASSETS.md](ASSETS.md) |
| Desktop Studio: hướng GUI, ranh giới với engine, roadmap | [DESKTOP-APP.md](DESKTOP-APP.md) |
| Nhật ký nghiên cứu hiệu ứng (nguồn, quyết định làm/không làm) | [SLIDESHOW_RESEARCH.md](SLIDESHOW_RESEARCH.md) |

Schema máy đọc: [`schema/timeline.schema.json`](../schema/timeline.schema.json) ·
Layout library: [`layouts/library.json`](../layouts/library.json) ·
Story mẫu: [`quoc-nhi-input-story.txt`](quoc-nhi-input-story.txt) ·
Sampler font: [`fonts-sampler.png`](fonts-sampler.png)

## Quick start

```bash
npm install

# Sinh timeline tự động từ input/ (generator theo orientation ảnh)
npm run gen -- --title "Tân & Hằng" --look cinematic

# Pipeline đầy đủ (một job = một thư mục projects/<id>/)
npm run project:create -- --id my-video --input input --music "music/track.mp3"
npm run lite -- --project projects/my-video        # hoặc: template | premium

# Render một timeline có sẵn (--dry-run: chỉ validate + in lệnh, không render)
npm run render -- --timeline timeline/timeline.json

# Mở desktop shell bước 1
npm run desktop
```

FFmpeg được tìm theo thứ tự: env `FFMPEG_PATH` → `ffmpeg-static` (devDependency đã cài) → PATH.
