# Web UI Plan — các tab của project

> Bản nháp lập kế hoạch, đọc codebase thật (không phải mockup) để suy ra tab. Ghi ngày 2026-07-21.
> Không phải spec thực thi — mục đích là chốt **hình dạng** trước khi code.

## 0. Giả định phạm vi (đọc trước khi phản đối bất kỳ mục nào bên dưới)

Repo hiện có **ba** mảnh UI, ở ba mức độ trưởng thành khác nhau, và không mảnh nào khớp hết với
backend hiện tại:

| Mảnh | Vị trí | Thực trạng |
|---|---|---|
| Electron renderer cũ | `desktop/renderer/` + `desktop/main.cjs` | **Có IPC thật**, chạy được: `analyze` → `director:{semantics,options,notes,plan,timeline}` → `dryRun` → `preview:{generate,select,approve,renderFull}` → `render:start`. Nhưng đây là đường **Premium/Lite node-by-node cũ** — không gọi `applyStoryTemplate.mjs` (tier template/recipe), không gọi `qaLoop.mjs`, không gọi `reviseProject.mjs`, không gọi `deliver.mjs`. |
| `desktop/ui/` ("StoReel") | React + Vite + Tailwind, bạn vừa mở `App.tsx` | **Mockup tĩnh 100%** — `projects`, `moods`, metric số, "Proposed story flow" đều hardcode trong component, không có `fetch`/IPC nào. Nav mới phác 5 mục: AI Director, Projects, Assets, Timeline, Render queue. Footer ghi "Studio Admin / Local production workspace" → đây là **công cụ vận hành của studio**, không phải trang khách tự đặt hàng. |
| `schema/web-job-request.schema.json` | mới thêm 2026-07-20 | Hợp đồng cho một **intake nhẹ** (webLanguage, sequenceMode, tier, prompt, photos[], musicMode?, recipe?) — validate xong bằng `test/web-contract.test.mjs`, nhưng **chưa có server nào đọc nó**. Đây là chữ ký của một web đặt hàng tự phục vụ trong tương lai, tách biệt khỏi StoReel. |

**Giả định của tài liệu này**: bạn đang hỏi về mảnh thứ hai — kế thừa/mở rộng StoReel thành web UI
thật của studio, dùng backend đầy đủ hiện có (không chỉ 5 IPC cũ). Phần §6 nói riêng về hướng
customer self-serve (web-job-request) vì nó là một sản phẩm khác, không trộn tab vào đây.

Ba nợ đã biết, **không** giả vờ là đã có UI cho chúng:
- **Không có cổng thanh toán/mở khoá** (bàn ở phiên trước, bạn chọn hoãn) → tab Delivery bên dưới
  chỉ có "watermark preview + xuất bản đầy đủ", không có nút "Pay".
- **Chưa có sửa kiểu point-and-click** trên timeline — sửa hiện tại là qua câu chữ
  (`reviseProject.mjs`), nên tab Revisions là ô chat/prompt + diff, không phải canvas kéo-thả.
- **`caption_language`/QA vision-bookend cần key thật** — verdict "unknown" là trạng thái hợp lệ
  phải hiển thị được, không phải lỗi.

---

## 1. Kiến trúc hai tầng

```
┌─ Studio nav (toàn cục, không phụ thuộc project) ──────────────┐
│  Dashboard · Projects · Recipe Library · Assets · Settings    │
└─────────────────────────────────────────────────────────────┘
        │ chọn / tạo 1 project
        ▼
┌─ Project workspace (theo đúng 7 phase job-manifest.schema.json
│  + vòng lặp revise nằm trên phase build) ──────────────────────┐
│  Intake → Photos & Music → Story (AI Director) → Timeline      │
│  → Render & QA → Revisions → Delivery                          │
└─────────────────────────────────────────────────────────────┘
```

Lý do tách hai tầng: `job-manifest.schema.json` đã định nghĩa đúng 7 phase
(`validate·analyze·plan·build·render·qa·deliver`) cho **một** project — tab trong workspace nên
bám sát đúng 7 phase này cộng vòng revise, thay vì bịa cấu trúc riêng. Studio nav là lớp quản lý
nhiều project cùng lúc, StoReel mockup đã đúng hướng ở tầng này.

---

## 2. Studio nav (tầng ngoài)

### 2.1 Dashboard
Giữ đúng tinh thần mockup (card project đang chạy, metric, activity feed) nhưng **nguồn dữ liệu
đổi**: đọc `job-manifest.json` của từng project (`status`, `currentPhase`, `error`) thay vì số giả.
Card "Render progress 67%" → map từ `phases.render.status` + `phases.qa.status`.

### 2.2 Projects (danh sách)
Bảng project, mỗi hàng = 1 `project.json` + `job-manifest.json`. Cột tối thiểu: tên, `tier`
(template/lite/premium), `currentPhase`, `status` (running/completed/failed/paused — **paused ≠
failed**, đã có bài học đắt về việc gọi nhầm hai cái này trong docs), cập nhật lúc nào. Click vào
→ vào Project workspace (§3).

### 2.3 Recipe Library — **mục mockup hiện chưa có, nên thêm**
22 recipe trong `story-templates/` + theme trong `layouts/library.json` là tài sản bán được của
tier rẻ — cần một nơi duyệt chúng trước khi tạo project: ảnh bìa/contact-sheet mẫu, theme màu,
"độ dài phù hợp" (từ `fit.minPhotos`/`fit.maxPhotos` nếu recipe khai), danh sách look
(`scene_variety` — recipe nào có bao nhiêu "look" khác nhau, đúng luật lint #1 trong
`docs/TEMPLATE-RULES.md`). Không có tab này thì Intake (§3.1) không có gì để người dùng chọn khi
`--tier template`.

### 2.4 Assets
Đã có nền: `assets:catalog`/`assets:import`/`assets:analyze` IPC + `schema/assets-catalog.schema.json`
(fonts/overlays/backgrounds/frames, mỗi asset có `mood`/`bestFor`/`colors`). Giữ nguyên vai trò —
đây là tài sản DÙNG CHUNG toàn studio (không thuộc một project), nên đúng chỗ nó đang nằm.

### 2.5 Settings — **thêm, hiện không có**
Nơi cấu hình mà bây giờ đang nằm rải rác ở biến môi trường: `DEEPSEEK_API_KEY`/`OPENAI_API_KEY`
(hasKey() gate mọi node AI — UI nên hiện rõ "đang chạy STUB vì thiếu key" thay vì im lặng),
`FFMPEG_PATH`, ngôn ngữ mặc định studio, và (khi làm) cấu hình kênh gửi quyết định cho khách
(`scripts/lib/channels.mjs` — hiện có `console`/`file`, kênh thật như zalo/messenger sẽ cấu hình ở
đây).

---

## 3. Project workspace (tầng trong, theo project đã chọn)

### 3.1 Intake
Tạo `project.json` mới: tên cặp đôi, ngôn ngữ (`language: vi|en`), `sequenceMode`
(`editorial|chronological`), chọn `tier`. Nếu `tier=template` → bắt buộc chọn 1 recipe từ §2.3
("Recipe thiếu = lỗi cứng", đã ghi rõ trong `docs/current-state.md` §1b — tab này phải chặn submit
nếu chưa chọn, không âm thầm rơi về recipe mặc định). Đây cũng là nơi map gần nhất với
`web-job-request.schema.json` nếu sau này Intake nhận request từ một web đặt hàng ngoài thay vì
người vận hành gõ tay.

### 3.2 Photos & Music
- Upload/trỏ thư mục ảnh → chạy `analyzePhotos.mjs` (đã wired qua IPC `pipeline:run("analyze")`).
  Hiện kết quả: bao nhiêu ảnh, bao nhiêu portrait/landscape, bao nhiêu ảnh có focus point (bài học
  "silent-zeros" 2026-07-09 → nếu probe lỗi, UI phải nói to, không hiện bảng rỗng).
  - **Tier lite/premium**: thêm bước `analyzePhotoContent.mjs` (vision) — hiện chi phí ước tính
    (`--dry-run` đã có sẵn: số request, dung lượng base64) TRƯỚC khi bấm chạy thật, vì đây là node
    duy nhất có phí theo số ảnh.
- Upload nhạc → `analyzeMusic.mjs`. Hiện BPM/energy/độ dài.
- **Cull suggestion** (`schema/cull-suggestion.schema.json`, `scripts/suggestCull.mjs`) — khi ảnh
  vượt ngân sách bài hát: liệt kê ảnh đề xuất bỏ (kèm lý do, worst-first) và ảnh bị khoá (must-use/
  bookend/đại diện nhóm trùng) tách riêng. **Là đề xuất chờ duyệt, không phải hành động** — tab
  phải có bước "Áp dụng" tường minh, đúng mô tả trong schema.

### 3.3 Story (chỉ hiện khi `tier != template`)
Đây là nơi node 3→7 (Phase B) sống — thay hẳn "Director instructions textarea → Generate" một-cú-
bấm của mockup bằng đúng luồng nhiều bước đã có:
1. **Brief** — ô nhập tự do (giữ UI hiện tại của mockup, nó đúng ở phần này).
2. **4 hướng kể chuyện** (`generateStoryOptions.mjs` → `schema/story-options.schema.json`) — hiện
   **4 thẻ A–D** (title/mood/pacing/emotionalArc/summary/fitReason), không phải 1 kết quả duy nhất
   như mockup vẽ. Khách/vận hành chọn 1 → ghi `selected_story.json`
   (`schema/selected-story.schema.json`). **Cửa sổ quyết định là thật**: nếu tích hợp kênh gửi
   khách, tab phải hiện đếm ngược `decisionWindow.deadlineAt` và trạng thái "đang chờ khách" (job
   `paused`, không phải `failed`) — không tự chọn hộ trước hạn.
3. **Director notes** (node 5+6) — hiện creative brief + `director_notes` đã bị guardrail (hero/
   group/montage effect, transition, curves) — đây là bản audit-được, nên hiện dạng bảng "AI đã
   quyết gì" chứ không chỉ prose.
4. **Music window** (chỉ premium, gate 4b, `schema/selected-music.schema.json`) — y hệt pattern
   cửa sổ quyết định ở bước 2 nhưng cho `mode: highlight|full_song`, kèm `preview.start/end` để
   khách nghe thử đoạn được chọn trước khi chốt.
5. **Story plan** (node 7) — 5 màn Opening→Ending, mỗi màn goal/emotion/pacing/emphasis. Hiện dạng
   timeline ngang (mockup "Proposed story flow" 4 chapter đã gần đúng hướng, chỉ cần đổi thành 5 màn
   thật và bind dữ liệu thật thay vì hardcode).

### 3.4 Timeline
Đọc/ghi `timeline.json` qua `timeline:read`/`timeline:write`/`timeline:chooseImage` đã có sẵn. Hiện
tối thiểu: danh sách scene (id/effect/layout/duration/transition), ảnh gán mỗi slot, và — quan
trọng vì đã từng là bug thật — **preview đủ dài để thấy khung trắng cuối cùng của `mask_reveal`**
(bài học `tpad stop_mode=clone`). Không cần editor kéo-thả (ngoài phạm vi, xem §0); đổi ảnh 1 slot
qua `chooseTimelineImage` là đủ cho v1.

### 3.5 Render & QA
- `dryRun` (validate không render) → `render:start` (theo dõi qua `sendRenderEvent`, đã có cơ chế
  stream). Nút Cancel map thẳng `render:cancel`.
- **QA loop** (`qaLoop.mjs`, hiện KHÔNG có IPC — cần thêm) — hiện 3 lớp: pre-flight (pacing/hero,
  miễn phí, không tốn revision) → render → revise (qaClip + proxy, tốn budget, trần
  `--max-revisions`). Tab phải phân biệt rõ **"đang tự sửa" vs "hết cách, cần người xem"**
  (`manualReview` list) — verdict `ok`/`review`/`unknown` (unknown = chưa có key vision, không phải
  lỗi). Đúng bug vừa vá hôm nay: hiện rõ số pass pre-flight đã chạy, để một cascade dài không im
  lặng biến thành "review" giả.

### 3.6 Revisions — **mục mockup hoàn toàn chưa có, nhưng đây là sản phẩm thật**
Ghi lại đúng góc nhìn đã chốt ở phiên trước: recipe/timeline đầu tiên chỉ là khung, **sản phẩm bán
là kết quả sau khi khách yêu cầu sửa** (`reviseProject.mjs`, xem comment đầu file đó). Tab này cần:
- Ô nhập yêu cầu tự do (giống chat) → `--preview` trước: hiện diff bằng lời — cảnh nào đổi, cảnh
  nào **mất hẳn** (bị montage nuốt), chữ nào **mất theo** (trích nguyên văn, không phải đếm số) —
  đây là chỗ dễ mất lòng tin khách nhất nếu chỉ hiện "3 cảnh đã đổi".
  - Chặn commit và Yêu cầu confirm riêng khi `blastRadius = "plan"` (đổi hẳn câu chuyện) — đúng cờ
    `--confirm-restory` đã có.
- Lịch sử round dạng ledger, có nút **Undo <round>** (không phải "hoàn tác" ẩn dụ — đúng cơ chế
  rebuild-từ-ledger đã verify).
- Đồng hồ ngân sách sửa (`--max-rounds`, mặc định 2) hiện rõ còn bao nhiêu lượt — vì "hết lượt sửa
  vẫn phải giữ nguyên đoạn nuốt mất lời thề" là trải nghiệm tệ nếu không cảnh báo trước khi khách
  bấm gửi.
- Khi round mới áp dụng → tab Delivery (§3.7) phải tự chuyển preview trước đó sang trạng thái
  "invalidated" (`revisionInvalidation.mjs` đã có logic này) — không để khách duyệt nhầm bản cũ.

### 3.7 Delivery
`deliver.mjs` đóng gói `final.mp4`/`preview.mp4`/`thumbnail.jpg`/`project_summary.json`. Tab hiện:
- Preview có watermark (`--watermark`, `--preview-seconds`) để khách duyệt trước — **đây chính là
  điểm nối với mô hình giá "demo free, trả tiền mở khoá"**, nhưng vì cổng thanh toán/mở khoá thật
  CHƯA XÂY (§0), nút "Xuất bản bản đầy đủ" ở v1 này nên là hành động thủ công của vận hành viên
  (không giả vờ có nút Pay).
- `project_summary.json` hiện đúng những gì đã audit được: `tier` (không đoán — "unknown" là giá
  trị hợp lệ phải hiện), `provenance.photoContent` (stub vs vision thật — khách/vận hành cần biết
  hero score có phải AI thật chấm hay không), `qa.verdict`, `thumbnail.chosenBy`.

---

## 4. Tier ẩn/hiện tab

| Tab | template | lite | premium |
|---|---|---|---|
| Recipe Library, chọn recipe ở Intake | bắt buộc | ẩn | ẩn |
| Story (4 hướng, director notes, music window) | ẩn hoàn toàn | rút gọn (chỉ generateProjectStory, không có 4 lựa chọn) | đầy đủ |
| Photos & Music — bước vision | bỏ qua (`--skip-vision`, tier rẻ không được âm thầm chạy node đắt nhất) | có | có |
| Revisions | có (áp lên storyboard recipe) | có | có |
| QA | pacing/hero (rule-based) | + | + bookend (cần vision key) |

---

## 5. Đối chiếu nợ kỹ thuật cần trả trước khi tab nào đó "thật" được

- **Không có IPC cho**: `applyStoryTemplate.mjs` (build từ recipe), `qaLoop.mjs`, `reviseProject.mjs`,
  `deliver.mjs`, `suggestCull.mjs`, `selectStoryOption.mjs`/`selectMusicEdit.mjs` (cửa sổ quyết
  định). `desktop/main.cjs` hiện chỉ bọc đường Premium/Lite node-rời cũ — đây là khối việc backend
  lớn nhất trước khi bất kỳ tab nào ở §3.3/3.5/3.6/3.7 chạy thật thay vì mockup.
- **`desktop/renderer-v2/`** là bundle đã build (chỉ có `dist`, không thấy source trong repo) — cần
  xác nhận nó build từ đâu trước khi quyết định StoReel (`desktop/ui/`) có thay thế nó hay chạy song
  song.

## 6. Nhánh riêng: customer self-serve (web-job-request.schema.json)

Không phải tab trong studio ở trên — đây là một **mặt hàng khác**: khách tự vào web, upload ảnh
(giữ `uploadIndex` cho `sequenceMode: chronological`), viết `prompt`, chọn `tier`/`recipe`/
`musicMode`, `webLanguage` (khác `language` — ngôn ngữ giao diện có thể khác ngôn ngữ video, contract
đã phân biệt rõ). Hợp đồng đã có, **chưa có server đọc nó**. Nếu làm, nó gọn hơn nhiều so với §3 vì
gộp Intake+Photos+Music+chọn recipe vào MỘT form, rồi khách quay lại xem tiến độ qua đúng các cửa sổ
quyết định ở §3.3 bước 2/4 và §3.6 — không cần dựng lại, chỉ cần một "customer view" đọc-rút-gọn của
cùng dữ liệu.

---

## 7. Thứ tự làm hợp lý (không phải cam kết, chỉ là gợi ý theo phụ thuộc)

1. Recipe Library (§2.3) — chặn Intake nếu thiếu, mà lại rẻ nhất (đọc file tĩnh, không cần IPC mới).
2. IPC cho `applyStoryTemplate.mjs` + `qaLoop.mjs` + `deliver.mjs` — mở khoá toàn bộ nhánh tier
   template chạy thật trong UI (rẻ nhất về AI, nhiều test nhất, rủi ro thấp nhất).
3. Revisions (§3.6) — đây là sản phẩm thật theo đúng góc nhìn đã chốt, ưu tiên hơn hoàn thiện nốt
   nhánh Premium 4 hướng/music-window (vốn đã có IPC một phần, chỉ thiếu UI).
4. Cửa sổ quyết định thật (gửi khách qua kênh thật) — phụ thuộc Settings (§2.5) có kênh trước.
