# Desktop Studio

Mục tiêu desktop là biến engine hiện tại thành một phần mềm thao tác bằng giao diện, nhưng vẫn giữ
render core chạy headless và deterministic.

```text
Desktop UI
  -> Project Manager
  -> Asset Manager
  -> AI Director / Timeline Builder
  -> Render Queue
  -> engine local
  -> preview / export / logs
```

## Nguyên tắc

- Engine TypeScript/FFmpeg vẫn là lõi render. Desktop không tự sinh lệnh FFmpeg.
- Timeline JSON vẫn là hợp đồng kỹ thuật giữa UI/AI Director và engine.
- Desktop gọi các script/hàm local, đọc log và hiển thị trạng thái; không thay đổi rule validate.
- Asset mới phải đi qua catalog (`npm run analyze:assets`) trước khi AI Director chọn.
- Timeline cuối trỏ file local, không phụ thuộc URL ngoài mạng lúc render.

## Công nghệ

MVP dùng Electron với renderer tĩnh trong `desktop/renderer/`. Chưa dùng React/Vite để giữ bước đầu nhỏ
và không làm phình repo. Khi UI cần timeline editor phức tạp, có thể nâng renderer lên React/Vite mà không
đụng engine.

## Bước 1 hiện tại

Chạy:

```bash
npm run desktop
```

App mở cửa sổ **Wedding Render Studio** với màn Project:

- hiển thị project đang chạy từ repo hiện tại;
- chọn thư mục project bằng native folder dialog;
- kiểm tra nhanh các thư mục `input`, `music`, `timeline`, `analysis`, `assets`, `fonts`, `overlays`;
- kiểm tra `package.json`, `schema/timeline.schema.json`, `analysis/assets_catalog.ai.json`;
- hiển thị số lượng font/overlay/background/frame từ asset catalog nếu có.

## Bước 2 hiện tại

Tab **Assets** đã có:

- chọn loại asset: background, overlay, frame, font;
- import một hoặc nhiều file bằng native file dialog;
- copy file vào đúng thư mục project:
  - background -> `assets/backgrounds/`
  - overlay -> `assets/overlays/`
  - frame -> `assets/frames/`
  - font -> `fonts/`
- chạy `scripts/analyzeAssets.mjs` bằng nút **Analyze Assets**;
- đọc lại `analysis/assets_catalog.ai.json` và hiển thị counts + menu ngắn cho AI Director.

Tên file import được làm sạch nhẹ và tự thêm hậu tố `_2`, `_3` nếu trùng, để không ghi đè asset cũ.

## Bước 3 hiện tại

Tab **Pipeline** đã có luồng Lite:

- chọn nhạc trong project hoặc browse file ngoài project; file ngoài sẽ được copy vào `music/`;
- nhập timeline output, mặc định `timeline/desktop-lite.json`;
- **Analyze Inputs** chạy:
  - `scripts/analyzePhotos.mjs`
  - `scripts/analyzeMusic.mjs <music>`
- **Generate Lite Timeline** chạy:
  - `scripts/generateStoryClipV2.mjs --director none --plan none`
  - `scripts/fitTextInTimeline.mjs`
- **Dry Run** chạy engine ở chế độ `--dry-run` để validate/preflight/log FFmpeg command mà chưa render thật.

Output stdout/stderr được gom vào **Pipeline Log** trong UI. Đây là bước validate production flow trước khi thêm
render queue/progress realtime.

## Bước 4 hiện tại

Tab **Render** đã có render queue tối thiểu:

- nhập timeline cần render, mặc định đồng bộ từ tab Pipeline;
- **Start Render** chạy engine thật:
  - `node --import tsx src/index.ts --timeline <timeline>`
- log stdout/stderr được stream về **Render Log** khi process đang chạy;
- **Cancel** gửi tín hiệu dừng process render hiện tại;
- trạng thái hiển thị Idle / Running / Done / Failed;
- **Open Output** mở file output cuối cùng trong file explorer nếu render đã sinh file.

Mỗi lần chỉ cho một render process chạy để tránh tranh chấp `temp/`, `logs/`, `output/` trong cấu trúc project
hiện tại. Khi cần render song song nhiều job, bước sau nên tách job workspace riêng trước.

## Bước 5 hiện tại

Tab **Director** đã nối các node AI Director hiện có:

- **Analyze Semantics** chạy `scripts/analyzePhotoContent.mjs`.
  - Không có vision key thì script dùng STUB, đủ để pipeline chạy và đánh dấu rõ `generatedBy: "stub"`.
- **Story Options** chạy `scripts/generateStoryOptions.mjs` với creative brief từ UI.
- Người dùng chọn option A/B/C/D trong UI.
- **Director Notes** chạy `scripts/generateDirectorNotes.mjs --choice <A-D> --assets analysis/assets_catalog.ai.json`,
  nên Director có thể chọn `assetId` từ catalog thay vì tự bịa path.
- **Story Plan** chạy `scripts/generateStoryPlan.mjs`.
- **Generate Timeline** chạy `generateStoryClipV2` với `analysis/director_notes.json` và
  `analysis/story_plan.json`, sau đó chạy `fitTextInTimeline`.

UI hiển thị 4 story options và `asset_choices` hiện tại để biết AI Director đã chọn font/overlay/background/frame nào.

## Bước 6 hiện tại

Tab **Timeline** đã có editor tối thiểu:

- load timeline JSON từ path đang dùng trong Pipeline/Director;
- liệt kê toàn bộ scene theo `id`, `effect`, `duration`;
- chọn một scene để xem thông tin nhanh;
- sửa `duration` trong giới hạn engine 2-30s;
- sửa text layer/caption hiện có;
- thay ảnh trong `image`, `images[]`, hoặc image layer bằng native file dialog;
- file ảnh ngoài project được copy vào `input/`;
- **Save Slide** ghi thay đổi trở lại timeline JSON.

Editor này cố ý chưa cho sửa effect/transition/toạ độ layer tự do. Các trường đó vẫn nên đi qua generator/template
hoặc một editor chuyên dụng hơn để tránh tạo timeline khó validate.

## Roadmap

1. Project shell + chọn project folder. Đã có.
2. Asset Manager: import asset, chạy `analyze:assets`, xem catalog. Đã có.
3. Lite Pipeline: nút chạy analyze photo/music, generate timeline, dry-run. Đã có.
4. Render Queue: progress/log theo slide và final pass. Đã có bản tối thiểu.
5. AI Director: story options, director notes, asset choices. Đã có bản tối thiểu.
6. Timeline Preview/Editor: scene list, caption/photo swap, duration adjustment. Đã có bản tối thiểu.
