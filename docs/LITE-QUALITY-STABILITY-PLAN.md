# Kế hoạch nâng cấp Lite — chất lượng, ổn định và khả năng kiểm soát

**Trạng thái:** Phase 1–6 xong; Phase 7 đã có canary chạy được và **canary đang ĐỎ** — Lite không dựng nổi album 12 và 45 ảnh (§0.4). Audit 2026-08-02; Phase 6 đóng + canary dựng xong 2026-08-10  
**Phạm vi:** Pipeline `tier=lite` từ Story JSON đến delivery  
**Mục tiêu chính:** Mọi job Lite phải tạo được video đa dạng, dễ đọc, khớp nhạc và vượt qua cùng một quality contract trước khi render/delivery.  
**Regression chuẩn đầu tiên:** project `projects/tuan-tien-lite`

---

## 0. Trạng thái triển khai (audit 2026-08-02)

Phần lớn P0 đã vào code. Số đo dưới đây lấy từ `projects/tuan-tien-lite` sau khi chạy lite-v2, so với chính job đó trước khi sửa.

| Chỉ số | v1 (baseline §2.1) | v2 (hiện tại) | Mục tiêu §8.5 |
|---|---:|---:|---|
| Scene | 43 | 41 | — |
| Photo reference | 168 | 84 | — |
| Ảnh unique | 26 | 84 | phần lớn/toàn bộ 84 |
| Lần dùng nhiều nhất của một ảnh | 19 | 1 | 1 |
| Effect khác nhau | 3 (40/43 scene) | 8 | ≥4 visual family |
| Montage có ảnh trùng bên trong | 25 | 0 | 0 |
| Adjacent duplicate | 22 | 0 | 0 |
| Net duration | 202,00s (drift 33,27s) | 235,27s (drift 0,000s) | ±0,1s |
| Verdict QA / delivery | clean / failed | pass / pass | bằng nhau |

`npm run test:unit`: **418/418 pass**.

### 0.1. Đã hoàn thành

| DoD | Trạng thái | Bằng chứng |
|---|---|---|
| 1. Bỏ modulo layout và photo cursor | Xong | `generateProjectTimeline.mjs` viết lại hoàn toàn; không còn `photoCursor`, không còn `i % 2 ? film_roll_up : collage_grid` |
| 2. Common composer + global assignment | Xong | Lite gọi `composeStoryboard.mjs` rồi `applyStoryTemplate.mjs`; `--target-duration` thay cho hard-fail khi không có nhạc |
| 3. Recipe/storyboard artifact trước timeline | Xong | `analysis/lite-storyboard.json`, `analysis/lite-story-adapter.json` |
| 4. Caption và layer text chung fitter | Xong | `fitTextInTimeline.mjs` duyệt cả `captions[]` lẫn `layers[]`, xuất `analysis/text-fit.json` có `readingRate`/`readingLimit`/`blockers` |
| 5. Pacing repair đi qua global retime | Xong | `REPAIR_KINDS` đổi `set_duration` → `pacing_adjustment`; `qaLoop` áp cả plan rồi ghi lại `musicSync`; `retimeSlidesToMusic` assert drift ≤ 0,1s |
| 6. QA và delivery chung verdict evaluator | Xong | `lib/rules/verdict.mjs`; `qaLoop` và `deliver` cùng gọi `evaluateQualityReport`; `deliver` bỏ đường đọc `proxy.verdict` thô |
| 7. Regression Tuân Tiên | Xong | Đạt toàn bộ acceptance ở §8.5 |
| 8. Test matrix | Phần lớn | `test/lite-tier.test.mjs` có fixture long-form khẳng định pipelineVersion, storyboard, `usedUnique`, `reuses`, montage không liền kề, ≥4 effect, không trùng trong scene, drift ≤ 0,1s, và coverage đo trên timeline (xem 0.2) |
| 9. Ba style profile | Xong | `lib/liteStyleProfiles.mjs` có đủ ba profile; **regression gallery** (`npm run gallery:lite-profiles -- --project <p>`, khoá bằng `test/lite-profile-gallery.test.mjs`) **và render smoke + contact sheet cho cả ba** (`analysis/qa/profile-*.contact.jpg`). Render smoke bắt được lỗi easing làm `editorial_clean` không dựng được — xem §0.3 |
| 10. Pipeline/policy version + provenance | Xong | `pipelineVersion: lite-v2`, `qualityPolicyVersion: 2`, `POLICY_VERSION = 2`, `allocatorVersion: music-retime-v2`, `styleProvenance` |
| 11. Canary | Có công cụ, **đang đỏ** | `npm run canary:lite` chấm 5/8 chỉ số §11 trên album thật. Lần chạy đầu 5/7 case xanh; 2 case album ít ảnh không build được. Xem §0.4 |
| 12. Docs + gỡ Lite v1 | Xong | Planner v1 đã bị thay thế trực tiếp (không còn tồn tại song song) nên không có gì để gỡ; tài liệu này cập nhật 2026-08-10 |

Hai hạng mục kỹ thuật khác cũng đã đóng: ngưỡng tỷ lệ transition ở 4.4.5 được chốt bằng đo thật (`MAX_TRANSITION_RATIO = 0.30`, corpus 1.888 transition Template/Premium, p95 = 25%, max = 27%), và `deliver` nay chặn cả drift timeline↔`musicEdit` lẫn drift video-đã-render↔timeline — lỗ hổng mô tả ở 2.2.9 đã được bịt.

### 0.2. Một cảnh báo sai, và lỗ hổng đo lường thật đứng sau nó

Bản audit đầu tiên của mục này báo một defect: timeline Tuân Tiên có 84 reference nhưng chỉ 82 ảnh unique, hai ảnh lên phim hai lần và hai ảnh bị bỏ rơi. **Chẩn đoán đó sai.** Nó đo trên `timeline.json` sinh lúc 07:06, tức sản phẩm của một trạng thái code cũ hơn. Chạy lại pipeline trên cây hiện tại cho **84 reference / 84 unique / maxUse 1**, và log tạm đặt ngay tại chỗ tra khoá trong `layerSceneBuilder` không ghi nhận một lần tra trượt nào. Hai lần chạy liên tiếp cho ra file giống hệt nhau từng byte, nên invariant "timeline là hàm deterministic của input" (§3.1) cũng có bằng chứng.

Đây là đúng cái bẫy mà kế hoạch này tồn tại để chặn, chỉ khác là nó bắt người đi audit chứ không bắt pipeline: **đọc một artifact mà không kiểm nó được sinh bởi code nào.** Rút ra một quy tắc cho mọi lần đọc số về sau — regenerate rồi mới đo, hoặc đối chiếu mtime của artifact với mtime của code đã sinh ra nó.

Nhưng lỗ hổng khiến chẩn đoán sai đó *trông* hợp lý thì có thật, và đã được vá. `photo-assignment.json` chỉ mô tả **bản kế hoạch**: `usedUnique` đếm sổ sách của solver (tính cả ảnh bookend được reserve), `references` đếm slot đã assign. Không con số nào nhìn thấy bộ phim. Trên job này chúng in ra `84 / 82` trong khi phim là `84 / 84` — hai cặp số khác nhau cho cùng một job, và không cặp nào sai theo định nghĩa của nó. Một report như vậy không thể dùng để bác bỏ lẫn xác nhận nghi vấn trùng ảnh.

Đã vá trong `applyStoryTemplate.mjs`: sau khi timeline được ghi, report có thêm khối `timeline` đo trên chính file vừa ghi.

```json
"timeline": {
  "references": 84, "usedUnique": 84, "maxUses": 1,
  "selectedNotRendered": [], "assignedNotRendered": []
}
```

`assignedNotRendered` là chữ ký của đúng lỗi bị nghi ngờ: ảnh mà solver đã phân nhưng không lên phim, tức một slot tra trượt khoá và tự bốc từ pool. Nó nay được in ra stdout kèm chữ WARNING. `test/lite-tier.test.mjs` khẳng định cả bốn: `assignedNotRendered` rỗng, `maxUses === 1`, `usedUnique === references`, và report phải khớp với timeline nó đi kèm.

Các assert này đã được kiểm chứng là **không rỗng**: tiêm hỏng khoá tra assignment thì test đỏ đúng dòng `the solver assigned photos that never reached the timeline`, khôi phục thì xanh. `npm run test:unit` giữ nguyên 418/418.

Còn lại thuần vận hành: regression gallery cho ba style profile (Phase 6), canary và dọn docs (Phase 7).

### 0.3. Phase 6 đóng ngày 2026-08-10 — một defect, một bộ số đo, và một hướng đã thử rồi bỏ

**Defect: chọn profile bằng tay chưa bao giờ chạy được.** `generateProjectTimeline.mjs:34` đọc
`project.manifest.styleProfile` và truyền vào `resolveLiteStyleProfile({ requested })`, nhưng
`schema/project.schema.json` để `additionalProperties: false` và **không khai** `styleProfile` — nên mọi
`project.json` mang field đó bị `loadProject()` từ chối trước khi generator kịp chạy. Nhánh `requested`
chỉ sống trong unit test gọi thẳng hàm; đường duy nhất chọn được profile trong production là đoán từ
keyword của prompt. Đã vá bằng một `enum` ba giá trị trong schema. Guard: `provenance === "requested"`
trong `test/lite-profile-gallery.test.mjs` — đã kiểm chứng là **không rỗng** (gỡ bản vá schema ra thì
test đỏ đúng dòng `Invalid project manifest`).

**Gallery.** `npm run gallery:lite-profiles -- --project <p>` dựng cùng một album ba lần, mỗi lần một
profile, **giữ nguyên project id** — `nudgeGrade()` seed theo id, nên đổi id là grade lệch vì lý do
không liên quan tới profile và phép so sánh mất nghĩa. Fingerprint lấy từ **timeline đã sinh**, không
lấy từ bảng cấu hình: theme, font thật sự được nạp, tập effect/transition/layout, grade, drift, coverage
ảnh. Kèm một cổng mới: quét **cmap** của từng font để xác nhận phủ đủ dấu tiếng Việt — `subsets` của
Google không khớp với glyph trong TTF, và một font thiếu dấu là lỗi *vô hình* với mọi cổng khác (render
thành công, QA thấy có chữ, khách nhận về một hàng ô vuông).

Số đo trên job thật `projects/tuan-tien-lite` (84 ảnh, 41 scene, cả ba profile drift 0,000s, 84/84 ảnh,
0 trùng trong scene, 0 finding font):

| Cặp | effects | transitions | layouts | trung bình |
|---|---:|---:|---:|---:|
| gentle vs film | 0,28 | 0,43 | **0,94** | 0,55 |
| gentle vs editorial | 0,28 | 0,43 | **1,00** | 0,57 |
| film vs editorial | 0,14 | 0,43 | **0,94** | 0,50 |

**Nợ đã lộ ra: profile không có layout palette.** Effect và transition khác nhau rõ; **layout thì gần
như trùng khít** — gentle và editorial dùng *chung 100%* layout. Nguyên nhân ở
`lib/storyboard.mjs`: rotor layout rút từ **toàn bộ** library, và `layoutMix` chỉ quyết định *bao nhiêu*
scene là card chứ không quyết định *card nào*. §5.3 liệt kê "Layout palette/family" là một phần của
profile; phần đó chưa từng được implement.

**Đã thử vá và đã bỏ — ghi lại để phiên sau không đi lại đường cũ.** Thêm `layoutPalette` cho ba profile
(nối qua `director_notes` → grammar → rotor, kèm ưu tiên palette trong `composedRepair`) **có hiệu quả về
chất lượng**: layout overlap 0,94–1,00 → **0,21–0,29**, trung bình 0,55 → 0,28–0,33, job 84 ảnh sạch mọi
cổng. Nhưng nó làm **6–7 fixture album nhỏ trong `test/lite-tier.test.mjs` đỏ** với
`Global photo assignment could not fill … the shot list is over-drawn by 0` — ngân sách đúng, *hình dạng*
sai. Ba cách sửa đều thất bại:

1. Thu hẹp rotor nhưng giữ `buckets` nguyên cho `allocatePhotos` — vẫn đỏ 7/7.
2. Bù lại cho đủ **phủ** orientation (mỗi orientation ít nhất một layout) — còn đỏ 6/7.
3. Bù lại cho đủ **tỷ lệ** layout `orient: "any"` bằng bucket gốc — vẫn đỏ 6/7.

Kết luận đo được: thứ làm kẹt không phải orientation mà là **`assignPhotos` là greedy exact-fit và không
backtrack**, nên bất kỳ thay đổi nào về *tỷ lệ* slot có ràng buộc đều có thể dồn nó vào ngõ cụt trên album
khít budget. Làm layout palette an toàn đòi một solver biết quay lui — việc lớn hơn Phase 6 nhiều. Toàn bộ
nhánh này **đã revert**; `npm run test:unit` giữ 525/525. Ai làm tiếp: đây là hạng mục **P1**, và điều kiện
tiên quyết là solver, không phải palette.

**Render smoke từng profile bắt một lỗi chặn mà cả gallery lẫn mọi cổng tầng timeline đều mù.**
Gallery chấm `editorial_clean` sạch trên mọi chỉ số — vì nó không bao giờ thử render. Khi render
thật thì phim **chết ở validate, trước khi encode một khung hình**:
`slide s27 easing "snap" only applies to zoom/pan/kenburns effects (got "panel_flip")`. Nguyên nhân
là hai danh sách nói về cùng một thứ mà lệch nhau: `EASED_MOTION_EFFECTS` trong `src/types.ts` liệt
kê **10** effect do zoompan điều khiển, còn `EASING_EFFECTS` trong `scripts/lib/engineCapabilities.mjs`
**suy ra từ cờ `motion`** nên có **13** — dư `panel_flip`, `floating_card_gallery`,
`moving_background_echo`. `motion` là khái niệm rộng hơn: một cú lật panel có chuyển động nhưng
không chạy bằng zoompan. `editorial_clean` là profile Lite duy nhất chạm tới một trong ba effect
đó, nên **mọi phim Lite ở profile ấy đều không dựng được** — và đó chính xác là lý do mục "render
smoke riêng cho từng profile" tồn tại. Đã vá bằng danh sách tường minh + guard chống trôi trong
`test/vocab.test.mjs` (guard có chống rỗng: regex parse ra <8 effect là test đỏ).

Sau khi vá, cả ba profile render sạch (preview cut 20s trên 84 ảnh thật), contact sheet ở
`projects/tuan-tien-lite/analysis/qa/profile-*.contact.{jpg,json}`, cả hai profile mới cho cùng
hình dạng kết quả: 3 pass / 2 warning, cờ duy nhất `color_review`, 0 error. **Còn để mắt:** khung
`panel_flip` trong contact sheet nhòe tới mức gần như không đọc được chữ — QA chấm `pass`, nhưng
đây đúng là loại việc contact sheet sinh ra để một người nhìn.

**Hai hạng mục Phase 7 đóng vì vô nghĩa theo cấu trúc.** "So sánh v1/v2" và "rollback window ở cấp
pipeline version" giả định v1 và v2 từng chạy song song. Chúng chưa bao giờ: planner v1 bị **thay thế tại
chỗ**, không còn tồn tại để so sánh hay để rollback về. Giữ chúng làm việc-còn-mở vĩnh viễn là nói dối
bảng trạng thái. Canary trên album thật vẫn còn giá trị và vẫn mở.

### 0.4. Canary — chạy được rồi, và nó đỏ ngay lần đầu

`npm run canary:lite` (`scripts/runLiteCanary.mjs`). Nó chạy **build** Lite trên corpus album
thật và chấm **5 trong 8** chỉ số §11 — đúng những chỉ số quyết định được trước khi encode:
build có chạy không, drift, trùng ảnh trong scene, text blocker, và tính tất định. Ba chỉ số còn
lại (first-pass delivery, render failure rate, render time) cần encoder nên thuộc về một lượt
render lấy mẫu riêng. Tách như vậy để canary chạy bằng **phút** thay vì 15–48 phút *mỗi album*, tức
là chạy được đủ thường xuyên để bắt hồi quy. Album gốc **không bao giờ bị sửa**: mỗi case stage vào
`temp/` và trỏ vào ảnh gốc theo đường dẫn, không copy một tấm nào.

**Kết quả lần chạy đầu (2026-08-10): 5/7 case build được, 1 vi phạm.**

| Case | Ảnh | Kết quả |
|---|---:|---|
| photo-rich / portrait-heavy | 85 | ✅ 31 scene, drift 0s, 0 trùng, 0 text blocker |
| photo-fewest-real / landscape-heavy | 83 | ✅ 37 scene, drift 0s, 0 trùng, 0 text blocker |
| photo-poor-25 | 25 | ✅ 17 scene, drift 0s, 0 trùng, 0 text blocker |
| **photo-poor-12** | 12 | ❌ `could not fill: s04:bg, s10:wide` — over-drawn by **0** |
| **photo-poor-45** | 45 | ❌ `could not fill: s19:hero, s33:bg` — over-drawn by **0** |

Hai case đỏ là **lỗi production có thật, không phải do thay đổi nào trong pass này** (cây đã revert
sạch, `test:unit` xanh). Ngân sách đúng — *over-drawn by 0* — nhưng solver greedy exact-fit không
thoả nổi vài slot cụ thể. Đây chính là acceptance của §7 Phase 2 chưa hề đạt trên album thật:
*"Small-album fixture vẫn tạo timeline hợp lệ hoặc dừng với fit decision rõ ràng — cụ thể là không
còn kết thúc bằng lỗi `unfilled`"*. Và nó **cùng một gốc** với thứ đã chặn layout palette ở §0.3:
`assignPhotos` không biết quay lui. Một sửa chữa, hai hạng mục.

**Một báo động giả đã bị loại bỏ trước khi vào báo cáo.** Bản canary đầu dùng
`buildLiteQualityReport().text.estimatedOverflow` và báo 8–10 caption tràn trên **mọi** album. Sai:
trường đó là ước lượng theo số ký tự (`length > 60 && không có xuống dòng`), còn fitter thật
(`fitTextInTimeline`) là một bước riêng của orchestrator, chưa chạy tại thời điểm đo. Canary nay tự
gọi fitter rồi đọc `blockers` — kết quả **0 blocker trên cả 5 case**. Một canary kêu sói mỗi lần
chạy thì không ai còn đọc nó nữa.

**Hai giới hạn của corpus, ghi ra để không tưởng là đã phủ hết:**
1. **Chỉ 5/54 album đủ điều kiện** — canary cần `story-template.generated.json`, mà 49 album kia là
   tier template nên không có. Mở rộng corpus = sinh story stub (đường offline tất định, đã có) cho
   những album đó. Đây là việc rẻ và nên làm trước khi coi canary là đủ đại diện.
2. **Không có nhạc ngắn** — track ngắn nhất trên đĩa là 189s. Trục "nhạc ngắn/dài" của §7 Phase 7
   chưa được phủ; cần cắt một track rồi `analyzeMusic` lại. Canary tự in dòng `uncovered` này mỗi
   lần chạy.

---

## 1. Tóm tắt quyết định kiến trúc

Không tiếp tục mở rộng bộ generator riêng hiện tại của Lite bằng thêm `if/else`, effect hoặc vòng quay mới. Lite phải dùng chung các khối lập kế hoạch đã có của engine:

- `scripts/lib/storyboard.mjs` để tính photo budget, scene count, scene shape và nhịp.
- `scripts/lib/photoAssignment.mjs` để gán ảnh toàn cục, chống trùng và giữ đa dạng.
- `layouts/library.json` và recipe compiler để chọn layout đã được kiểm chứng.
- `scripts/lib/musicRetime.mjs` để giữ tổng thời lượng khớp nhạc sau mọi thay đổi.
- Một quality contract duy nhất cho `qaLoop` và `deliver`.

Pipeline đích:

```text
Upload ảnh + nhạc + prompt
        ↓
Photo/Music Analysis
        ↓
AI Story JSON
  story-template.generated.json
        ↓
Lite Story Adapter (deterministic)
  story intent + copy ngắn + style profile
        ↓
Common Storyboard Composer
  scene count + photo budget + layout/effect/transition grammar
        ↓
Job-specific Recipe
  analysis/lite-storyboard.json
        ↓
Global Photo Assignment + Recipe Compiler
        ↓
Timeline JSON
  kế hoạch thực thi cụ thể cho renderer
        ↓
Text Fit + Global Music Fit
        ↓
Pre-render Quality Gate
        ↓
Render → Frame QA → Delivery Gate
```

Vai trò artifact:

| Artifact | Vai trò | Có tái sử dụng không? | Có chứa path/timing cụ thể không? |
|---|---|---:|---:|
| `story-template.generated.json` | Nội dung và nhịp cảm xúc của câu chuyện | Không | Không bắt buộc |
| `lite-storyboard.json` | Recipe được compose riêng cho job | Không | Có slot/scene duration, chưa nhất thiết gắn file cuối |
| `timeline.json` | Kế hoạch thực thi cuối cùng | Không | Có đầy đủ ảnh, timing, effect, transition, text |
| `RenderPlan` | Timeline đã normalize/compile cho FFmpeg/Remotion | Không | Có path tuyệt đối và command-ready data |

AI không sinh trực tiếp `timeline.json`. AI quyết định nội dung và ý đồ; code quyết định cấu trúc kỹ thuật, giới hạn và tính hợp lệ.

---

## 2. Baseline lỗi cần loại bỏ

Project Tuân Tiên là regression đại diện cho các lỗi hệ thống, không phải ngoại lệ riêng của một album.

> **Mục này là hồ sơ lịch sử của Lite v1.** Các số liệu bên dưới đã được khắc phục — xem bảng so sánh ở §0. Giữ nguyên vì đây là mô tả chính xác của lỗi mà mọi invariant ở §4 tồn tại để chặn, và là thứ regression test phải tái hiện được khi chạy ngược về v1.

### 2.1. Số liệu hiện tại

Tất cả số dưới đây đã được đo lại từ artifact trong `projects/tuan-tien-lite`, không phải ước lượng.

- 84 ảnh đã được chọn nhưng timeline chỉ dùng 26 ảnh khác nhau.
- 168 lượt tham chiếu ảnh; một ảnh xuất hiện 19 lần, bốn ảnh xuất hiện 16 lần.
- 25/25 scene montage đều có ảnh trùng bên trong; 20 trong số đó chỉ chứa ≤2 ảnh unique.
- 25/43 scene là `collage_grid` hoặc `film_roll_up`.
- 15/43 scene là `portrait_blur_background`.
- 40/43 scene thuộc đúng 3 effect; chỉ 3 scene có chuyển động khác.
- 9/10 caption dài trên 60 ký tự, bị preflight cảnh báo vượt safe width nhưng vẫn render.
- `fitTextInTimeline` điều chỉnh 0 caption vì chỉ xử lý `layers[type=text]`, mà timeline Lite không phát sinh `layers[]` nào. Cùng lý do đó, pass thêm backing surface trong file này (`fitTextInTimeline.mjs:47-58`) cũng không bao giờ chạy cho Lite.
- Nhạc dài 235,27 giây; timeline sau QA còn 202,00 giây, drift 33,27 giây.
- Proxy QA phát hiện 22 adjacent duplicate, `qaLoop` báo `status: clean` nhưng delivery báo failed.

Bằng chứng cho hai lỗi cuối, vì đây là hai lỗi dễ bị chẩn đoán sai nhất:

- `analysis/qa/timeline.loop.json` ghi đúng 8 repair `set_duration` với flag `too_slow_for_music`, tổng cộng đúng 33,27 giây bị cắt khỏi phim. `metadata.musicSync` trong timeline vẫn khai `targetDuration: 235.27` — tức là timeline nói dối về chính độ dài của nó sau khi QA sửa.
- `analysis/qa/timeline.proxy.json` có `verdict: "review"` với 22 problem `duplicate_photo/adjacent_duplicate`. Với Lite, `duplicate_photo` được map thành `WARN` (`scripts/lib/rules/policy.mjs:58`), nên `qaLoop` lọc chúng ra và kết luận clean. `deliver.mjs:333` thì không gọi policy — nó đọc thẳng `proxy.verdict` thô và dừng job. Đây là hai lớp policy khác nhau đọc cùng một report, không phải hai report khác nhau.

### 2.2. Nguyên nhân kiến trúc

1. Lite có một planner riêng, không dùng common storyboard composer.
2. Montage được hardcode luân phiên `film_roll_up`/`collage_grid` (`generateProjectTimeline.mjs:107`), transition và single effect cũng chọn bằng modulo scene index (dòng 102 và 119).
3. `preferredPhotos` đang hoạt động như nguồn ảnh bắt buộc thay vì ưu tiên mềm. Đây là nguyên nhân trực tiếp của montage 2-ảnh-lặp-3-lần: `preferredPhoto()` chỉ loại ảnh trùng với `lastPicked`, nên một beat có 2 preferred photo sẽ trả về A,B,A,B,A,B cho 6 slot.
4. Photo assignment diễn ra cục bộ theo từng lần gọi, không tối ưu toàn timeline.
5. Caption và text layer đi qua hai pipeline layout khác nhau.
6. **Có hai mô hình pacing cạnh tranh nhau, và QA sửa theo mô hình không sinh ra timeline.** `musicRetime` phân bổ thời lượng theo trọng số scene rồi snap vào phrase/downbeat; `qaProxy` lại tự suy ra kỳ vọng riêng bằng `sceneDur(energyTrungBình) * pacingScale` (`qaProxy.mjs:387`) và ép duration về đó. Trên track này phrase cách nhau ~15 giây nên retime hợp lệ tạo ra vài scene 9,25 giây, và QA gọi đúng những scene đó là `too_slow_for_music`. Vì vậy chỉ "chạy global retime sau khi repair" là chưa đủ: retime sẽ đẩy lại, QA sẽ cắt lại, và kỷ luật fix-once của `qaLoop` biến vòng dao động đó thành một lần cắt im lặng. Hai mô hình phải hợp nhất thành một allocator.
7. QA policy và delivery policy không dùng chung một verdict function (xem bằng chứng ở 2.1).
8. Style prompt được map vào vài thuộc tính rời rạc thay vì một style profile đầy đủ.
9. **Không có check nào canh drift giữa timeline và track.** Lite map `audio_drift` thành `BLOCK`, nhưng check đó so sánh stream video với stream audio *của file đã render* (`qaProxy.mjs:547-553`). Một phim ngắn hơn bài hát 33 giây vẫn có audio và video dài bằng nhau, nên drift đo được ≈ 0 và cổng chặn nghiêm nhất của Lite không hề nhìn thấy lỗi này. Invariant ở 4.4.2 là một check mới, không phải siết một check đã có.

---

## 3. Mục tiêu và phi mục tiêu

### 3.1. Mục tiêu

- Timeline Lite là hàm deterministic của ảnh, nhạc, story, style profile và directive ledger.
- Không duplicate ảnh trong cùng scene khi đủ ảnh hợp lệ.
- Không adjacent duplicate khi pool còn lựa chọn khác.
- Không reuse trước khi đã tiêu thụ photo pool hợp lệ theo budget.
- Không có chuỗi layout/effect lặp gây cảm giác template máy móc.
- Caption tiếng Việt luôn nằm trong safe area và đủ thời gian đọc.
- Tổng thời lượng cuối khớp music edit sau mọi QA/revision.
- Lỗi cấu trúc được chặn trước render.
- `qaLoop` và `deliver` luôn cho cùng một kết luận với cùng input.
- Khi không thể đạt chất lượng do album/nhạc không phù hợp, pipeline phải báo rõ và yêu cầu quyết định, không âm thầm tạo video kém.

### 3.2. Phi mục tiêu

- Không cho AI tự do sinh timeline kỹ thuật.
- Không xây một “Lite planner v2” song song với common composer.
- Không thêm hàng loạt effect chưa có render test chỉ để tăng con số diversity.
- Không giải quyết chất lượng bằng random hóa; output phải tái lập được.
- Không làm Lite chạy semantic QA đắt tiền như Premium theo mặc định.
- Không thay đổi Template/Premium nếu không cần cho common contract.

---

## 4. Quality invariants bắt buộc

Các invariant dưới đây là hợp đồng sản phẩm. Chúng phải có test và phải chạy trước render.

### 4.1. Photo assignment

1. `unique(filesInScene) === filesInScene.length` khi số ảnh hợp lệ đủ cho slot.
2. Không được dùng hai ảnh có cùng `duplicateGroup` trong một scene.
3. Scene liền nhau không dùng lại cùng file hoặc cùng `duplicateGroup` nếu còn candidate khác.
4. Opening và closing hero được reserve; không được rò vào body trừ khi album quá nhỏ và policy cho phép.
5. `preferredPhotos` là scoring bonus, không phải exclusive pool.
6. Mọi ảnh reuse phải có lý do ghi trong planning metadata: `pool_exhausted`, `must_use`, `story_match` hoặc `small_album_fallback`.
7. Nếu layout yêu cầu nhiều ảnh hơn số candidate unique, planner phải hạ photo count/layout, không duplicate để lấp ô.
8. Chênh lệch use count giữa ảnh được dùng nhiều nhất và ít nhất phải nằm trong reuse budget của job.
9. Với album đủ ảnh, phải dùng hết ảnh selected trước khi bắt đầu vòng reuse thứ hai.

### 4.2. Layout/effect diversity

1. Không có hai montage liền nhau, trừ sequence được khai báo rõ.
2. Không quá 2 scene liên tiếp cùng `visualSignature`.
3. Không quá 2 scene liên tiếp dùng `portrait_blur_background`.
4. Video dài từ 120 giây phải có tối thiểu 4 visual family đã được verify, nếu photo mix cho phép.
5. Montage density được quyết định bởi photo budget và music energy, không bởi modulo scene index.
6. Special effect có usage cap và chỉ xuất hiện ở role phù hợp.
7. Layout phải tương thích số ảnh, orientation và face safety.
8. Closing phải khác visual signature của scene ngay trước nó.

### 4.3. Typography và copy

1. Tất cả `captions[]` và `layers[type=text]` đi qua cùng một fitter.
2. Safe width mặc định không vượt 86% canvas; theme có thể dùng mức nhỏ hơn.
3. Text block không vượt safe top/bottom margins.
4. Caption tối đa 3 dòng; mặc định ưu tiên 2 dòng.
5. Title, subtitle và body có min/max font size riêng.
6. Font phải tồn tại và vượt glyph smoke test cho tiếng Việt.
7. Text trên ảnh phải có backing surface, gradient, outline hoặc contrast đạt ngưỡng.
8. Copy không được trùng giữa hai scene gần nhau, ngoại trừ echo có chủ ý được khai báo.
9. Caption duration phải đáp ứng reading-time policy.
10. Nếu copy không fit: wrap → shrink trong giới hạn → rút gọn deterministic → chia scene; không render text bị cắt.

Reading-time mặc định đề xuất:

| Loại | Giới hạn khởi điểm |
|---|---:|
| Title ngắn | tối thiểu 2,5 giây |
| Caption tiếng Việt | 14–18 ký tự/giây |
| Caption tiếng Anh | 2,5–3 từ/giây |
| Closing | tối thiểu 4 giây |

Giá trị cuối phải được khóa bằng test thực tế, không coi bảng trên là tuning vĩnh viễn.

### 4.4. Pacing và music fit

1. Net duration được tính theo công thức duy nhất:

   ```text
   sum(scene.duration) - sum(non-final transition.duration)
   ```

2. `abs(netDuration - musicEdit.duration) <= 0.1s` trước render và trước delivery. Đây là check mới trên timeline; `audio_drift` hiện có đo file đã render nên không thay thế được (xem 2.2.9).
3. Chỉ có **một** allocator quyết định thời lượng scene. QA không tự tính kỳ vọng bằng công thức riêng và không sửa `slide.duration` trực tiếp; QA phát biểu ý định (giữ scene này ngắn lại) rồi allocator phân bổ lại toàn phim. Nếu kỳ vọng của QA và phân bổ của allocator còn là hai công thức khác nhau thì mọi thứ còn lại trong mục này đều vô nghĩa.
4. Scene duration phải nằm trong engine limits sau retime.
5. Transition duration không vượt `min(MAX_TRANSITION_SEC, tỷ lệ tối đa × scene duration)`. **Đã chốt:** `MAX_TRANSITION_RATIO = 0.30` trong `musicRetime.mjs`, đo trên 1.888 transition Template/Premium đang được chấp nhận (p95 = 25%, max = 27%). Ngưỡng 18% mà bản draft đầu đề xuất sẽ đánh trượt corpus đó và vi phạm phi mục tiêu 3.2 — đây là lý do con số phải đo trước khi khóa.
6. Caption timing phải được clamp/fit lại sau retime. `retimeSlidesToMusic` đã clamp `caption.duration` (`musicRetime.mjs:125-133`); cái còn thiếu là fit lại *nội dung* (wrap/size) khi scene ngắn đi, và reading-time phải được kiểm lại sau đó chứ không chỉ trước.
7. Slow style phải giữ thời gian nhìn ổn định tối thiểu giữa hai visual changes.
8. Nếu full song không phù hợp số ảnh, dùng music-fit decision hiện có: highlight, loop, thêm ảnh hoặc xác nhận mismatch; không tự lặp ảnh vô hạn.

### 4.5. QA/delivery consistency

Bảng policy theo tier **đã tồn tại** ở `scripts/lib/rules/policy.mjs` (`actionFor(tier, check)` với 4 action `block/repair/manual-review/warn`) và `qaLoop` đã dùng nó. Mục này vì vậy không phải là xây một policy layer mới — mà là bắt phần còn lại của pipeline đi qua đúng bảng đó.

**Đã làm:** `lib/rules/verdict.mjs` (`evaluateQualityReport`) dựng trên chính bảng đó; `qaLoop` và `deliver` cùng gọi nó; `deliver` không còn đọc `proxy.verdict` thô; `POLICY_VERSION = 2` được ghi vào `qa/static-gate.json` và `qa/final-verdict.json`; `duplicate_photo` cho Lite đã lên `BLOCK` (mục 7 dưới đây đã được quyết).

1. Một hàm duy nhất quyết định `pass | review | block` theo tier, dựng **trên** `actionFor()`, không song song với nó.
2. `qaLoop` và `deliver` phải gọi cùng hàm với cùng report. Cụ thể: `deliver.mjs:333` phải bỏ cách đọc `proxy.verdict` thô và phân loại problem qua policy.
3. Không có trạng thái `qa=clean` nhưng `deliver=failed` vì cùng một finding.
4. Finding được phân biệt rõ theo đúng bốn action đã có, không đặt tên thứ năm.
5. Sau repair phải chạy lại toàn bộ invariant bị ảnh hưởng.
6. Report cuối phải ghi policy version và pipeline version.
7. Một quyết định sản phẩm cần chốt trước khi code: `duplicate_photo` đang là `WARN` cho Lite. Nếu Phase 2 làm cho adjacent duplicate trở thành lỗi thật sự hiếm thì rule này nên lên `BLOCK` hoặc `REPAIR` cho Lite; giữ `WARN` mà vẫn để delivery chặn là tình trạng hiện tại dưới một cái tên khác.

---

## 5. Thiết kế pipeline chi tiết

### 5.1. Story generation giữ vai trò sáng tạo

`generateProjectStory.mjs` tiếp tục sinh:

- `title`
- `beats[]`
- `heading`
- `body`
- `emotion`
- `preferredPhotos`
- `closing`

Thay đổi contract:

- `sceneKind` chỉ là ý định (`single`, `montage`, `chapter`, `detail`) và không map 1:1 vào effect.
- `preferredPhotos` phải được validate và giới hạn; chúng không điều khiển trực tiếp mọi slot.
- Body dài được giữ cho story/audit nhưng adapter phải tạo `screenCopy` ngắn riêng.
- AI không được trả layout geometry, duration, file path ngoài catalog hoặc renderer config.

### 5.2. Lite Story Adapter

Thêm một adapter deterministic, không phải planner mới. Nhiệm vụ:

1. Chuẩn hóa story beat thành act/role mà common composer hiểu.
2. Tạo copy ngắn cho màn hình từ heading/body.
3. Resolve style profile từ prompt/directives.
4. Truyền photo preference dưới dạng scoring hints.
5. Ghi provenance để audit biết quyết định đến từ story, style hay fallback.

Artifact đề xuất:

```json
{
  "version": 1,
  "pipelineVersion": "lite-v2",
  "styleProfile": "white_wedding_gentle",
  "acts": [
    {
      "id": "meeting",
      "heading": "Gặp Gỡ",
      "screenCopy": "Giữa Sài Gòn, hai tâm hồn đồng hương tìm thấy nhau.",
      "emotion": "warm",
      "photoHints": ["...jpg"]
    }
  ]
}
```

### 5.3. Style profile

Style profile phải là whitelist cấu hình đã qua render smoke, không phải JSON tự do từ model.

Mỗi profile định nghĩa:

- Library theme.
- Layout palette/family.
- Single-photo effect palette.
- Montage effect palette.
- Transition grammar theo role.
- Title/body font pairing.
- Color grade.
- Caption backing/readability policy.
- Pacing curve.
- Overlay/special-effect caps.

Profile tối thiểu cho rollout:

1. `white_wedding_gentle`
2. `warm_film_story`
3. `editorial_clean`

Không mở rộng thêm profile trước khi ba profile này có regression gallery và smoke test ổn định.

Fallback:

- Prompt không resolve được → `white_wedding_gentle` hoặc profile mặc định cấu hình theo sản phẩm.
- Profile thiếu asset/font → fail validation trong CI/startup, không fallback im lặng giữa job.

### 5.4. Common storyboard composition

Lite gọi `composeStoryboard()` với:

- `photoCount` từ đúng selected pool sau exclude.
- `musicDuration` từ đúng music edit/playlist.
- Energy envelope từ music analysis.
- `DEFAULT_GRAMMAR` được merge với style profile.
- `maxReuse` theo fit decision, mặc định 1.
- Acts/roles từ Lite Story Adapter.

Composer chịu trách nhiệm:

- Scene count.
- Photo count mỗi scene.
- Scene shape.
- Montage placement.
- Duration weights.
- Layout/effect rotation theo least-used.
- Transition role, không xoay vòng modulo.

Output được lưu thành `analysis/lite-storyboard.json`. Đây là recipe theo job và là điểm debug chính trước timeline.

Hai ghi chú về mức độ thay đổi thực tế:

- Hàm `composeStoryboard()` trong `lib/storyboard.mjs` đã nhận `musicDuration` như một tham số thuần, đã có `maxReuse`, và đã xoay palette bằng least-used (`createRotor`) chứ không modulo. Chế độ không nhạc chỉ là thiếu sót ở **CLI** (hard-fail khi không có `--music`), nên bản sửa là thêm `--target-duration` chứ không đụng thuật toán — đã làm, và `generateProjectTimeline` truyền cờ này khi project không có track.
- Với Tuân Tiên, đường này tự nó đã cho kết quả đúng: `maxReuse: 1` và 84 ảnh cho `capacity = 84`, `ideal ≈ 41` scene, tức khoảng 41 scene tiêu hết 84 ảnh unique. Mục tiêu coverage ở 8.5 không cần cơ chế mới nào.

### 5.5. Photo assignment toàn cục

Mọi photo slot phải đi qua `assignPhotos()`; không có nhánh lấy ảnh trực tiếp từ cursor/pool.

**Điều kiện tiên quyết mà bản draft trước bỏ sót — nay đã làm.** `assignPhotos()` trước đó *không có khái niệm reuse*: nó giữ một `used` set toàn cục và chỉ xét `!used.has(p.file)`, nên khi tổng số slot vượt số ảnh, nó trả `unfilled` và job dừng. Hàm này nay nhận `maxReuse`, mở vòng reuse chỉ khi pool unique đã cạn, và trả `reuses[]` kèm lý do cùng `adjacentCollisions`. Yêu cầu ban đầu vẫn giữ nguyên giá trị làm đặc tả:

- Chỉ mở vòng reuse khi pool unique đã cạn (đúng invariant 4.1.9).
- Reuse tôn trọng reuse budget đến từ `maxReuse` mà composer đã dùng để tính capacity — hai chỗ phải đọc cùng một con số, nếu không composer sẽ hứa nhiều slot hơn assignment có thể trả.
- Mỗi lần reuse ghi lý do theo enum ở 4.1.6.
- Vẫn giữ nguyên hai ràng buộc cứng: không trùng trong scene, không trùng `duplicateGroup` với scene lân cận.

Phần **chưa** đóng: `assignPhotos` sạch không đủ để phim sạch. Bước dựng scene vẫn có đường vòng `take()` không biết assignment đã tiêu những file nào, và đó là defect duy nhất còn lại của regression Tuân Tiên — xem 0.2.

Scoring đề xuất theo thứ tự:

1. Hard constraints: file hợp lệ, orientation, subject count, must-use/exclude.
2. Không trùng trong scene.
3. Không trùng scene lân cận.
4. Story/beat relevance.
5. Opening/closing/hero score.
6. Quality/sharpness/face safety.
7. Least-used bonus.
8. Diversity penalty theo orientation + people pattern.

Assignment report phải ghi:

- Unique photo coverage.
- Reuse distribution.
- Unfilled slots.
- Adjacent collisions.
- Duplicate-group collisions.
- Lý do mọi fallback/reuse.

### 5.6. Recipe/timeline compilation

Recipe compiler tiếp tục sở hữu:

- Geometry.
- File resolution.
- Layout layers.
- Effect vocabulary.
- Caption/text slots.
- Transition enums.
- Renderer routing.

Timeline compiler không được tự đổi story/layout selection. Nó chỉ concretize recipe + assignments + copy thành timeline hợp lệ.

Timeline metadata bổ sung:

```json
{
  "pipelineVersion": "lite-v2",
  "storyboard": "analysis/lite-storyboard.json",
  "styleProfile": "white_wedding_gentle",
  "qualityPolicyVersion": 2,
  "photoCoverage": {
    "selected": 84,
    "usedUnique": 84,
    "references": 92
  }
}
```

### 5.7. Text fitting thống nhất

Refactor `fitTextInTimeline.mjs` thành logic dùng chung cho:

- `slide.captions[]`
- `slide.layers[].type === "text"`
- Text slot được recipe compiler materialize

Fitter phải dùng glyph measurement thực, không chỉ character estimate.

Thứ tự xử lý:

1. Resolve font và glyph support.
2. Xác định safe box theo role/theme.
3. Wrap và balance line.
4. Đo width/height thực.
5. Shrink trong min/max role.
6. Tính reading time.
7. Rút gọn/chia copy nếu policy cho phép.
8. Ghi `textFit` metadata: original, final, lines, size, reason.

Preflight phải coi mọi overflow còn lại là blocker.

### 5.8. Global music retime

API duy nhất đó **đã có**: `retimeSlidesToMusic(slides, music, options)` trong `scripts/lib/musicRetime.mjs`, đã được cả Lite lẫn template tier gọi. Nó đã clamp min/max scene, đã clamp transition, đã clamp caption timing, đã ném lỗi có số liệu khi shot list không phủ nổi track, và đã trả `sync` provenance.

Vì vậy đây là mở rộng, không phải viết mới. Đừng đặt tên hàm mới là `retimeTimelineToMusic` — tên đó đang là một script CLI (`scripts/retimeTimelineToMusic.mjs`) và trùng tên sẽ gây nhầm ngay trong lúc grep.

**Đã làm, đúng theo hướng này:** `retimeSlidesToMusic` nay nhận `pacingAdjustments` (dạng mảng hoặc map, hệ số clamp `0,5–1,5`), export `timelineNetDuration`, `ALLOCATOR_VERSION = "music-retime-v2"` và `MAX_TRANSITION_RATIO`, tính `drift` rồi ném lỗi nếu vượt 0,1s. `qaProxy` hỏi chính allocator này thay vì tự tính (`qaProxy.mjs:326-329`), và `qaLoop` áp nguyên plan thay vì gán từng `slide.duration`. Phần dưới đây giữ lại làm đặc tả.

Phần cần thêm vào `retimeSlidesToMusic`:

- Nhận `pacingAdjustments`: ý định tương đối theo scene (nhấn/nén), gộp vào `weights` trước khi phân bổ, thay cho việc QA gán duration tuyệt đối.
- Trả về `drift` đo được và assert `abs(net - target) <= 0.1s` thay vì để caller tự tin.
- Ghi vào `sync` cả version của allocator, để report cuối biết timeline được phân bổ bởi mô hình nào.

Và phần bắt buộc phải bỏ đi ở đầu kia: `qaProxy` không được tự suy ra `expected` bằng công thức riêng nữa (`qaProxy.mjs:387`). Nó phải hỏi cùng allocator đó xem scene này *đáng lẽ* dài bao nhiêu. Nếu không, QA và retime vẫn là hai ý kiến khác nhau về cùng một bài hát và vòng lặp sẽ dao động — đúng như 2.2.6.

QA chỉ được tạo `pacingAdjustments`, không mutate duration trực tiếp.

Sau retime:

- Clamp scene durations.
- Clamp transition ratios.
- Clamp caption timing, rồi **fit lại nội dung caption** (wrap/size/reading-time) cho những scene vừa bị rút ngắn.
- Fit lại closing.
- Assert net duration.
- Ghi sync provenance và residual drift.

### 5.9. Pre-render gate

Gate chạy sau khi timeline hoàn chỉnh và trước encode:

```text
Schema/semantic validation
→ asset existence
→ photo uniqueness/reuse/coverage
→ layout diversity
→ text fit + reading time
→ face/crop safety
→ transition ratio/grammar
→ music duration drift
→ closing integrity
→ directive compliance có thể kiểm chứng
```

Nếu có blocker:

- Không render.
- Ghi report có scene id, rule, evidence và suggested repair.
- Chỉ tự repair nếu repair deterministic và sau repair phải chạy gate lại.

---

## 6. Thay đổi theo file/module

Hầu hết các hàng P0 dưới đây đã được thực hiện — xem bảng trạng thái ở §0.1. Bảng này giữ lại làm bản đồ "thay đổi nằm ở đâu", hữu ích khi đọc lại lịch sử hoặc khi port sang tier khác.

| File/module | Thay đổi dự kiến | Mức độ |
|---|---|---:|
| `scripts/runProject.mjs` | Lite build gọi adapter + common composer + recipe compiler; ghi pipeline version | P0 |
| `scripts/generateProjectTimeline.mjs` | Thu gọn thành compatibility adapter hoặc thay nội bộ bằng common pipeline; bỏ modulo layout và cursor assignment | P0 |
| `scripts/lib/storyboard.mjs` | Tái sử dụng nguyên trạng; đã có `maxReuse`, least-used rotor, `musicDuration` dạng tham số | P0 |
| `scripts/composeStoryboard.mjs` | Cho phép Lite dùng story adapter/default grammar; thêm `--target-duration` để bỏ hard-fail khi không có `--music` (dòng 71) | P0 |
| `scripts/lib/photoAssignment.mjs` | **Thêm reuse pass có budget/reason** (hiện chưa reuse được lần nào), enforce unique-within-scene, collision report | P0 |
| `scripts/applyStoryTemplate.mjs` | Nhận job-specific Lite storyboard/copy hints mà không thêm AI call; `origin:"composed"` đã bỏ qua re-solve nên giữ nguyên | P0 |
| `scripts/fitTextInTimeline.mjs` | Fit cả captions và layer text; xuất metadata/report. Hiện chỉ duyệt `layers[]` nên với Lite cả hàm là no-op | P0 |
| `src/captionFilter.ts` | Render multiline/safe box đúng; không dựa vào một dòng vô hạn | P0 |
| `src/preflightTimeline.ts` | Text overflow, duration drift, duplicate montage thành structured finding. Hiện caption chỉ được kiểm bằng ước lượng ký tự và chỉ đẩy string vào `warnings[]` (dòng 270-286), không có check chiều cao/số dòng | P0 |
| `scripts/lib/musicRetime.mjs` | Mở rộng `retimeSlidesToMusic`: nhận `pacingAdjustments`, trả drift, assert net duration | P0 |
| `scripts/qaProxy.mjs` | Bỏ mô hình pacing riêng; lấy kỳ vọng duration từ allocator. Thêm check drift timeline↔`musicEdit` (`audio_drift` hiện chỉ đo file render nên mù với lỗi này) | P0 |
| `scripts/qaLoop.mjs` | Không mutate duration riêng (hiện gán thẳng ở dòng 126-129); phát `pacingAdjustments` rồi chạy lại retime và invariant gate | P0 |
| `scripts/lib/rules/policy.mjs` | Bảng tier×rule đã có; thêm version, và chốt lại hàng `duplicate_photo` cho Lite | P0 |
| `scripts/deliver.mjs` | Dùng cùng verdict evaluator với QA thay vì đọc `proxy.verdict` thô (dòng 333) | P0 |
| `scripts/lib/diversityPlanner.mjs` | Dùng `visualSignature()` (đã có trong `lib/lookResolver.mjs`) cho report của Lite; rule `layout_repetition` cũng đã có, việc cần làm là nâng mức và nối vào gate | P1 |
| `layouts/library.json` | Xác nhận các layout family dùng trong Lite profile; không thêm geometry chưa verify | P1 |
| Module style profile mới | Whitelist profile và resolve prompt/directive → profile | P1 |
| `test/lite-tier.test.mjs` | Mở rộng regression/invariant tests | P0 |
| Regression fixture Tuân Tiên | Album metadata + story + music analysis tối giản, không cần ảnh thật cho planner tests | P0 |
| Release smoke tests | Render text tiếng Việt, montage diversity và duration seam | P1 |
| Docs pipeline/current-state | Cập nhật sau khi v2 trở thành default | P2 |

Nguyên tắc thay đổi: ưu tiên gọi lại module hiện có; chỉ tạo module mới cho Story Adapter và style profiles, không nhân đôi composer/assignment/retime.

---

## 7. Kế hoạch triển khai theo phase

### Phase 0 — Đóng băng regression và đo baseline

#### Công việc

- Tạo fixture mô phỏng Tuân Tiên: 84 photo records, 8 story beats, track 235,27 giây.
- Thêm script/report thống kê timeline:
  - scene/effect/layout counts
  - unique photo coverage
  - duplicate/reuse distribution
  - caption fit/read time
  - net duration/drift
  - QA/delivery verdict
- Ghi baseline hiện tại vào test output hoặc snapshot có chủ ý.
- Ghi lại số test đang pass của `npm run test:unit` **trước** khi bắt đầu, kèm danh sách test đang đỏ vì lý do khác. Repo này thường có nhiều session sửa song song; không có mốc này thì không phân biệt được đỏ do mình với đỏ có sẵn.

#### Verify

- Fixture cũ tái hiện được ít nhất các lỗi: duplicate trong montage, adjacent duplicate, layout repetition, text overflow và duration drift sau QA simulation.
- Test phải đỏ trước khi sửa.
- Có một test khẳng định `qaLoop` báo clean trong khi `deliver` từ chối cùng report đó — đây là bằng chứng máy đọc được cho mục 4.5, và là test sẽ chuyển xanh ở Phase 5.

### Phase 1 — Chuyển Lite sang common storyboard composer

#### Công việc

- Thay scene-count/layout/effect logic riêng của Lite bằng `composeStoryboard()`.
- Sinh `analysis/lite-storyboard.json`.
- Dùng default grammar khi không có style/director input.
- Giữ deterministic seed/order; không thêm random.
- Hỗ trợ cả có nhạc, playlist và không nhạc.

#### Verify

- Net duration ban đầu khớp target.
- Montage không adjacent.
- Không còn modulo `film_roll_up`/`collage_grid`.
- Long-form fixture có đủ visual family theo policy.
- Existing Lite tests vẫn pass hoặc được migrate có giải thích.

### Phase 2 — Global photo assignment

#### Công việc

- Thêm reuse pass có budget/reason vào `assignPhotos()` **trước tiên** — hiện hàm này không reuse được, nên chuyển Lite sang nó mà chưa làm bước này sẽ làm hỏng mọi album photo-poor (xem 5.5).
- `maxReuse` của composer và reuse budget của assignment đọc chung một giá trị.
- Mọi slot của Lite đi qua `assignPhotos()`.
- Enforce uniqueness trong scene và duplicate group.
- Preferred photo trở thành weighted hint. Lưu ý `assignPhotos` đã có `request.preferred` với trọng số 10000 — đủ mạnh để hành xử như ràng buộc cứng; chọn lại con số này cho đúng nghĩa "ưu tiên mềm".
- Degrade layout khi thiếu candidate unique.

#### Verify

- Tuân Tiên fixture có 0 duplicate trong montage.
- Có 0 adjacent duplicate khi pool đủ.
- Không reuse trước khi pool được dùng hết.
- Small-album fixture vẫn tạo timeline hợp lệ hoặc dừng với fit decision rõ ràng — cụ thể là không còn kết thúc bằng lỗi `unfilled` từ `applyStoryTemplate`.
- Regression của Template/Premium (`test/tier1-quality.test.mjs`, `test/tier1-album-regression.test.mjs`) vẫn xanh: `assignPhotos` là code dùng chung, sửa nó là chạm vào hai tier kia.

### Phase 3 — Unified text system

#### Công việc

- Fit captions và layers bằng cùng measurer.
- Thêm screen-copy adapter và reading-time policy.
- Thêm title/body font pairing theo style profile.
- Thêm readability surface cho caption trên ảnh.
- Chuyển overflow warning thành repair/block.

#### Verify

- 100% caption trong fixture nằm trong safe box.
- Không caption nào dưới min font size.
- Không caption nào vượt reading-rate limit.
- Render smoke với chuỗi tiếng Việt có đầy đủ dấu.
- Preflight fail khi cố tình đưa caption không thể fit.

### Phase 4 — Pacing, transition và global music fit

#### Công việc

- Hợp nhất mô hình pacing: `qaProxy` lấy kỳ vọng duration từ chính allocator của `musicRetime` thay vì công thức energy riêng. Làm việc này **trước**, vì các bước dưới đây vô nghĩa nếu hai bên vẫn bất đồng.
- QA tạo pacing adjustment thay vì sửa duration trực tiếp.
- Chạy global retime sau mọi mutation.
- Áp transition grammar theo role/style/music.
- Đo tỷ lệ transition/scene trên corpus Template + Premium hiện tại, rồi mới chốt ngưỡng ở 4.4.5.
- Thêm check drift timeline↔`musicEdit.duration` vào cả static gate lẫn delivery.

#### Verify

- Tuân Tiên luôn kết thúc ở `musicEdit.duration ± 0,1s` (job này là 235,27s) sau QA simulation.
- Trên fixture Tuân Tiên, số repair `set_duration` là 0, hoặc nếu có thì net duration vẫn đúng sau đó.
- Caption không bị chạy quá scene sau retime, và caption của scene bị rút ngắn được fit lại chứ không chỉ bị cắt thời lượng.
- Không transition đặc biệt vượt usage cap.
- Slow profile không đổi hình dày hơn policy.
- Ngưỡng tỷ lệ transition mới không làm đỏ regression của Template/Premium.

### Phase 5 — Quality contract thống nhất

#### Công việc

- Tạo verdict evaluator chung **trên nền `actionFor()` đã có**, không dựng bảng policy thứ hai.
- `qaLoop` và `deliver` cùng dùng evaluator; `deliver` bỏ đường đọc `proxy.verdict` thô.
- Chuẩn hóa structured findings và policy version.
- Chốt lại hàng `duplicate_photo` cho Lite (xem 4.5.7).
- Chặn encode khi static gate đã biết timeline sai.

#### Verify

- Cùng report luôn cho cùng verdict ở QA và delivery.
- Không còn case `qa clean / deliver failed`.
- Mọi blocker có evidence và scene id.
- Repair xong bắt buộc rerun affected invariants.

### Phase 6 — Style profiles và visual tuning — ✅ đóng 2026-08-10 (xem §0.3)

#### Công việc

- ✅ Cài ba profile verified ban đầu.
- ✅ Resolve prompt/directive sang profile — kể cả đường **chọn tay**, vốn bị schema chặn (§0.3).
- ✅ Tạo regression gallery cho từng profile — `npm run gallery:lite-profiles`.
- 🟡 Tune typography, grade, transition và layout palette bằng cùng album fixtures — typography/grade/
  transition xong; **layout palette là nợ P1**, đã thử và revert có số đo (§0.3).

#### Verify

- White wedding không có noise transition hoặc grade vàng/xanh quá mức.
- Font pairing hiển thị đúng tiếng Việt.
- Mỗi profile khác nhau có chủ ý nhưng cùng vượt technical gates.
- Profile resolution có provenance và fallback rõ ràng.

### Phase 7 — Rollout và loại bỏ Lite v1

#### Công việc

- ✅ Ghi `pipelineVersion: lite-v2` trong artifact.
- 🟡 Canary trên tập album đại diện — `npm run canary:lite` đã phủ ít/nhiều ảnh, portrait-heavy,
  landscape-heavy, Việt/Anh. **Chưa phủ nhạc ngắn**; corpus mới có 5/54 album đủ điều kiện; và
  lần chạy đầu **đỏ 2 case** (§0.4). Đây là hạng mục duy nhất còn mở của cả kế hoạch.
- ❌ So sánh v1/v2 bằng metrics và contact sheet — **vô nghĩa theo cấu trúc**, v1 không còn tồn tại (§0.3).
- ❌ Cho phép rollback ở cấp pipeline version — cùng lý do.
- ✅ Chuyển default và xóa planner v1 — v1 đã bị thay thế tại chỗ, không còn gì để xóa.

#### Verify

- Không project resume cũ bị âm thầm rebuild bằng pipeline version khác.
- V2 pass full test suite và release smoke.
- Không cần `--allow-qa-flags` cho album bình thường.
- Planner v1 không còn là nhánh production sau thời gian rollback window.

---

## 8. Test matrix bắt buộc

### 8.1. Planner/unit tests

- Photo-poor + long music.
- Photo-rich + short music.
- Mixed portrait/landscape.
- All portrait.
- Duplicate groups dày.
- Story preferred photo lặp trên nhiều beat.
- Playlist nhiều track.
- Music analysis cũ/thiếu phrase grid.
- Không có nhạc.
- Prompt/style không resolve được.

### 8.2. Text tests

- Caption Việt 40/80/160 ký tự.
- Dấu tiếng Việt đầy đủ.
- Title dài.
- Font thiếu glyph.
- Background sáng và tối.
- Text sau retime scene ngắn.
- Closing copy trùng body.

### 8.3. Quality policy tests

- Duplicate trong cùng montage → block/repair.
- Adjacent duplicate → block/repair theo pool state.
- Layout run vượt cap → repair hoặc block.
- Text overflow → repair, còn overflow → block.
- Audio drift → block.
- QA/delivery verdict equality.
- Policy version được ghi trong report.

### 8.4. Render/integration tests

- 20–30 giây smoke cut cho từng style profile.
- Contact sheet kiểm tra layout family.
- Render caption tiếng Việt ở 1080p.
- Full pipeline dry-run không encode khi static gate fail.
- Full project run sinh timeline, render, QA và delivery nhất quán.

### 8.5. Regression Tuân Tiên

Acceptance riêng:

- 0 ảnh trùng trong montage.
- 0 adjacent duplicate khi còn ảnh chưa dùng.
- Sử dụng phần lớn hoặc toàn bộ 84 selected photos theo shot budget; mọi ảnh bỏ lại có lý do.
- Không quá 2 scene liên tiếp cùng visual signature.
- Không quá 2 scene liên tiếp dùng portrait blur.
- Tối thiểu 4 visual family.
- 0 caption overflow.
- 0 caption vượt reading-time policy.
- Tổng thời lượng cuối khớp `musicEdit.duration ± 0,1s`. Với job này `fit_decision` chọn `natural/balanced` nên con số là 235,27s; acceptance phải viết theo `musicEdit`, vì một album khác có thể hợp lệ khi chọn highlight ngắn hơn.
- QA và delivery cùng `pass`, hoặc cùng block với một lý do có thể hành động.

---

## 9. Fallback và failure behavior

### 9.1. AI story lỗi hoặc không có provider key

- Dùng deterministic story stub như hiện tại.
- Vẫn đi qua cùng composer/assignment/text/music/QA pipeline.
- Ghi `generatedBy=stub`; không giảm quality gate.

### 9.2. Quá ít ảnh cho full song

Ưu tiên theo thứ tự:

1. Music highlight phù hợp.
2. Yêu cầu thêm ảnh.
3. Xác nhận cho phép hold lâu/loop có giới hạn.
4. Không tự duplicate dày để lấp full song.

### 9.3. Quá nhiều ảnh cho nhạc

- Dùng selection policy đã có.
- Ghi rõ ảnh không dùng và lý do.
- Không nhồi montage quá dày chỉ để đạt 100% coverage.

### 9.4. Copy không fit

Ưu tiên:

1. Wrap/balance.
2. Shrink trong giới hạn.
3. Dùng `screenCopy` ngắn.
4. Heading-only.
5. Chia thành card/scene nếu shot budget cho phép.
6. Block nếu vẫn không hợp lệ.

### 9.5. Style profile không hợp lệ

- Lỗi cấu hình phải fail sớm khi load profile/CI.
- Job không được tự chuyển sang một profile khác mà không ghi provenance.

---

## 10. Observability và artifact audit

Mỗi job Lite v2 cần lưu:

- `analysis/lite-story-adapter.json`
- `analysis/lite-storyboard.json`
- `analysis/photo-assignment.json`
- `analysis/text-fit.json`
- `analysis/music-fit.json`
- `analysis/qa/static-gate.json`
- `analysis/qa/final-verdict.json`

Job summary cần hiển thị tối thiểu:

```text
Pipeline: lite-v2
Selected photos: 84
Used unique: 82
References: 86
Reuses: 4 (all after pool exhaustion)
Scenes: 34
Visual families: 6
Caption repairs: 3
Text blockers: 0
Music target: 235.27s
Timeline duration: 235.25s
Drift: -0.02s
Static gate: pass
Frame QA: pass
Delivery: pass
```

Không log nội dung nhạy cảm hoặc API key. Artifact phải project-local như contract hiện tại.

---

## 11. Chỉ số chất lượng sau rollout

Các chỉ số dùng để quyết định Lite v2 đủ ổn định để làm default:

- 0 technical text overflow trên regression corpus.
- 0 within-scene duplicate khi đủ candidate.
- 0 music drift vượt 0,1 giây.
- 100% equality giữa QA verdict và delivery verdict.
- 100% timeline deterministic với cùng inputs/version.
- Tỷ lệ first-pass technical delivery đạt mục tiêu vận hành đã thống nhất.
- Giảm mạnh adjacent duplicate và layout-run findings so với Lite v1.
- Không tăng render failure rate hoặc render time ngoài budget đã chấp nhận.

First-pass rate và render-time budget phải được đo trên canary trước khi chốt con số SLA chính thức.

---

## 12. Rủi ro và cách giảm thiểu

| Rủi ro | Tác động | Giảm thiểu |
|---|---|---|
| Common composer thay đổi hành vi Premium/Template | Regression ngoài Lite | Tái sử dụng API hiện có; thêm hook Lite nhỏ, tránh sửa thuật toán chung nếu không cần |
| Layout phong phú làm render chậm | Tăng chi phí | Chỉ dùng palette verified; cap montage/special effect; benchmark canary |
| Fitter rút gọn copy làm mất ý | Giảm chất lượng story | Giữ original trong Story JSON; chỉ tạo `screenCopy`; provenance rõ |
| Gate nghiêm khiến nhiều job block | Giảm throughput ban đầu | Repair deterministic trước; fit decision rõ; canary và đo blocker distribution |
| Profile mapping sai | Style lệch prompt | Profile whitelist nhỏ; audit evidence; preview/contact sheet |
| Resume artifact cũ không tương thích | Job cũ đổi output | Pin `pipelineVersion`; invalidation theo artifact dependency/version |
| Album ít ảnh | Dễ buộc reuse | Music highlight/confirmation thay vì lặp im lặng |
| Sửa `assignPhotos`/`storyboard` làm hồi quy Template + Premium | Regression ngoài Lite, khó thấy | Chạy `test:unit` đầy đủ chứ không chỉ test Lite; mọi thay đổi reuse phải giữ nguyên hành vi khi `maxReuse = 1` |
| Verify visual bằng frame cũ | Kết luận sai về chất lượng | `temp/scene-cache/` không tự invalidate khi code renderer đổi — xóa cache trước khi dựng contact sheet/regression gallery |
| QA và allocator vẫn là hai mô hình | Vòng lặp dao động, drift quay lại dưới dạng khác | Hợp nhất trước, đo sau; test phải khẳng định net duration chứ không chỉ khẳng định "không còn repair" |

Một câu hỏi sản phẩm chưa được trả lời trong bản này: sau Phase 1–2, Lite chạy đúng chuỗi composer + assignment + recipe compiler như Premium, nên khác biệt còn lại giữa hai tier chỉ là ai viết copy (AI hay adapter deterministic) và độ sâu của QA. Cần chốt rõ điều đó trước Phase 7, vì nó quyết định cả định giá lẫn việc chi phí planning của Lite được phép tăng bao nhiêu — mục 12 mới chỉ tính chi phí render.

---

## 13. Definition of Done

Lite v2 được coi là hoàn thành khi:

1. Lite production không còn dùng modulo layout hoặc local photo cursor cũ.
2. Lite đi qua common storyboard composer và global photo assignment.
3. Có job-specific recipe/storyboard artifact trước timeline.
4. Caption và text layer dùng chung fitter và mọi overflow còn lại là blocker.
5. Mọi pacing repair được global-retime và giữ music drift trong tolerance.
6. QA và delivery dùng chung verdict evaluator.
7. Regression Tuân Tiên vượt toàn bộ acceptance criteria.
8. Test matrix gồm small/large/mixed albums đều pass.
9. ✅ Ba style profile ban đầu có regression gallery (`npm run gallery:lite-profiles`, khoá bằng
   `test/lite-profile-gallery.test.mjs`) **và render smoke + contact sheet cho cả ba** (§0.3).
10. ✅ Pipeline version, policy version và provenance xuất hiện trong artifact.
11. 🟡 Canary: công cụ đã có và chạy được (`npm run canary:lite`); **chưa đạt** — 2/7 case đỏ ở
    build, và 3/8 chỉ số §11 vẫn cần một lượt render lấy mẫu (§0.4). **Mục cuối cùng còn mở.**
12. ✅ Documentation về Lite được cập nhật; Lite v1 đã bị thay thế tại chỗ nên không có rollback window
    để chờ (§0.3).

---

## 14. Thứ tự ưu tiên thực tế

### P0 — Ngăn video sai được render/giao

1. Regression fixture Tuân Tiên.
2. Reuse pass cho `assignPhotos()` — chặn trước 3, vì nếu không thì bước 3 làm hỏng album ít ảnh.
3. Common composer cho Lite.
4. Global photo assignment và duplicate invariants.
5. Caption fitting cho `captions[]`.
6. Hợp nhất mô hình pacing giữa `qaProxy` và `musicRetime`, rồi global retime sau QA.
7. Unified QA/delivery verdict — rẻ nhất trong nhóm này (bảng policy đã có, chỉ cần `deliver` gọi nó), nên có thể làm sớm để lấy tín hiệu.

### P1 — Nâng chất lượng hình ảnh

1. ✅ Style profiles.
2. ✅ Transition grammar theo role.
3. ✅ Typography pairing/readability surfaces.
4. ✅ Visual diversity report và regression gallery theo profile.
5. ⬜ **Layout palette theo profile** — nợ mới, lộ ra nhờ chính gallery ở mục 4. Điều kiện tiên quyết là
   `assignPhotos` biết quay lui; đừng thử lại palette trước khi có việc đó (§0.3).

### P2 — Vận hành và tối ưu

1. Metrics/dashboard.
2. Canary comparison tooling.
3. Render-time optimization/cache.
4. Xóa Lite v1 và migration cleanup.

P0 phải hoàn thành trước khi tiếp tục dùng Lite như một luồng có thể giao khách. P1 quyết định chất lượng thẩm mỹ; P2 quyết định khả năng vận hành lâu dài.
