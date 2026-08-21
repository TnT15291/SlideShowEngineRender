# Tiến độ triển khai Lite Quality Stability

**Kế hoạch nguồn:** `docs/LITE-QUALITY-STABILITY-PLAN.md`  
**Bắt đầu:** 2026-08-02  
**Trạng thái tổng thể:** P0 và P1 hoàn tất (render smoke cho cả 3 profile xong 2026-08-10); P2 chỉ còn canary — rollback window đã đóng vì vô nghĩa theo cấu trúc, xem `docs/LITE-QUALITY-STABILITY-PLAN.md` §0.3

## Quy ước trạng thái

- `[ ]` Chưa bắt đầu
- `[~]` Đang thực hiện
- `[x]` Hoàn tất và đã kiểm chứng
- `[!]` Bị chặn hoặc còn lỗi đã biết

## Tiến độ theo phase

### Phase 0 — Đóng băng regression và đo baseline

- [x] Ghi nhận trạng thái test unit trước thay đổi: 406 pass, 0 fail (9,56 giây).
- [x] Tạo fixture Tuân Tiên và báo cáo thống kê timeline.
- [x] Thêm regression test tái hiện các lỗi baseline, gồm chênh lệch verdict QA/delivery.
- [x] Xác nhận fixture tái hiện toàn bộ lỗi baseline trước khi sửa.

### Phase 1 — Chuyển Lite sang common storyboard composer

- [x] Chuyển Lite sang `composeStoryboard()` và sinh `analysis/lite-storyboard.json`.
- [x] Giữ deterministic behavior và hỗ trợ music/playlist/no-music.
- [x] Kiểm chứng scene grammar, duration và visual family.

### Phase 2 — Global photo assignment

- [x] Thêm reuse budget/reason vào `assignPhotos()`.
- [x] Đưa toàn bộ Lite slot qua global assignment, preferred photo là soft hint.
- [x] Enforce duplicate/adjacency/pool-exhaustion invariants và small-album fallback.
- [x] Chạy regression Template/Premium.

### Phase 3 — Unified text system

- [x] Hợp nhất fitter cho `captions[]` và text layers.
- [x] Thêm screen-copy, reading-time policy và readability surface.
- [x] Chuyển overflow còn lại thành repair/block cho `lite-v2` và kiểm chứng tiếng Việt.

### Phase 4 — Pacing, transition và global music fit

- [x] Hợp nhất duration allocator giữa QA và music retime (`music-retime-v2`).
- [x] Dùng pacing intent/global allocation thay cho `set_duration` cục bộ.
- [x] Đo 1.888 transition; p95=25%, p99/max=27%; chốt cap 30% và thêm timeline↔music drift gate.
- [x] Kiểm chứng duration/caption/transition regressions.

### Phase 5 — Quality contract thống nhất

- [x] Tạo evaluator chung dựa trên `actionFor()`.
- [x] Cho `qaLoop` và `deliver` dùng cùng evaluator/policy version 2.
- [x] Chặn encode khi static gate biết timeline sai.
- [x] Kiểm chứng verdict equality và rerun invariant sau repair.

### Phase 6 — Style profiles và visual tuning

- [x] Cài ba style profile và resolver có provenance/fallback.
- [x] Áp profile vào typography, grade, transition và effect/layout mix.
- [x] Cả ba profile đã có render smoke + contact sheet (2026-08-10). `warm_film_story` và
      `editorial_clean` render bằng preview cut 20s trên chính album Tuân Tiên (84 ảnh thật):
      `projects/tuan-tien-lite/analysis/qa/profile-*.contact.{jpg,json}`. Cả hai cho cùng một
      hình dạng kết quả — 3 pass / 2 warning, cờ duy nhất là `color_review`, 0 error.
- [x] Regression gallery theo profile: `npm run gallery:lite-profiles`, khoá bằng
      `test/lite-profile-gallery.test.mjs`.
- [!] **Render smoke bắt được một lỗi chặn mà mọi cổng tầng timeline đều mù.** `editorial_clean`
      **không render được**: composer gắn `easing: "snap"` lên `panel_flip`, `validateTimeline`
      từ chối, phim hỏng trước khi encode một khung hình. Nguyên nhân là hai danh sách lệch nhau —
      `EASED_MOTION_EFFECTS` trong `src/types.ts` có 10 effect, còn `EASING_EFFECTS` trong
      `scripts/lib/engineCapabilities.mjs` suy từ cờ `motion` nên có 13. Đã vá + guard chống trôi
      trong `test/vocab.test.mjs`. Contact sheet sau đó xác nhận `panel_flip` nhòe gần như không
      đọc được chữ; ngày 2026-08-19 effect này đã bị loại khỏi palette Lite `editorial_clean`
      (thay bằng `prism_split`). Engine và recipe authoring vẫn giữ effect cho nơi có art direction riêng.

### Phase 7 — Rollout và loại bỏ Lite v1

- [x] Ghi `pipelineVersion: lite-v2` và pin version khi resume.
- [~] Đã tạo report so sánh baseline/v2 trên Tuân Tiên; **chưa chạy corpus canary đầy đủ — đây là
      hạng mục duy nhất còn mở của cả kế hoạch.**
- [x] Rollback window: đóng vì vô nghĩa theo cấu trúc — planner v1 bị thay thế tại chỗ, chưa bao
      giờ chạy song song, nên không có gì để rollback về. Xem PLAN §0.3.
- [x] Unit, API, typecheck, docs, production build và full pipeline integration đều xanh.
      **Đính chính 08-09:** dòng này đã sai trong một khoảng thời gian. `test:integration` đỏ ở
      `coverage_below_floor` — không do Lite v2, mà do `photo_coverage` mất độ phân giải trên
      album 4 ảnh của chính test đó (15% của 4 = 0,6 → hạn mức 0). Đã sửa bằng hạn mức tối thiểu
      một ảnh; xem nhật ký 08-09 trong [PREMIUM-QUALITY-STABILITY-PROGRESS.md](PREMIUM-QUALITY-STABILITY-PROGRESS.md),
      nơi sở hữu rule này. Đo lại hôm nay: integration **1/1 xanh**.

## Nhật ký

### 2026-08-02

- Đã đọc kế hoạch và xác định thứ tự thực hiện P0 → P1 → P2.
- Đã kiểm tra worktree: có các thay đổi sẵn có ngoài phạm vi Lite; sẽ giữ nguyên và tránh chỉnh sửa các file đó nếu không bắt buộc.
- Bắt đầu Phase 0 bằng việc chạy baseline `npm run test:unit` trước mọi thay đổi code.
- Baseline `npm run test:unit`: **406 pass, 0 fail**, không có test đỏ sẵn có.
- Phase 0: fixture/report tái hiện đúng 43 scene, 168 reference/26 unique, 25 within-scene duplicate, 22 adjacent duplicate, 9 overflow, drift −33,27s và `qa=clean/delivery=failed`.
- Phase 1–2: Lite dùng common composer + recipe compiler + global assignment; fixture dài dùng 84/84 ảnh, 0 duplicate, 0 adjacent duplicate, 8 visual family.
- Phase 3: fitter chung đo glyph thật cho caption/layer; tiếng Việt, safe box, reading rate và backing surface có test.
- Phase 4: allocator `music-retime-v2`, pacing adjustment toàn cục, drift assert ±0,1s; transition cap 30% dựa trên corpus 1.888 mẫu.
- Phase 5: policy version 2 và evaluator chung; `duplicate_photo` của Lite được nâng thành `BLOCK`; QA/delivery verdict equality có test.
- Phase 6: ba profile `white_wedding_gentle`, `warm_film_story`, `editorial_clean` đã có resolver deterministic và validation font/effect/transition.
- Regression thực tế `projects/tuan-tien-lite`: 41 scene, 84/84 unique, 0 within/adjacent duplicate, 0 text blocker/reading violation, net 235,27s (drift 0), static gate `pass`, final policy verdict `pass` sau 1 crop repair deterministic.
- Baseline sau triển khai `npm run test:unit`: **418 pass, 0 fail**.
- Đã nâng `project-summary` schema cho shared verdict `pass/review/block` + `policyVersion`, đồng thời giữ `ok` để đọc manifest v1.
- Full pipeline integration (generate → render → resume → QA → deliver): **1 pass, 0 fail**; package giao hàng ghi `qa=pass`, policy version 2.
- Verification cuối: `typecheck` pass; `test:api` **124 pass, 0 fail**; `docs:check` pass (17 file); production `build` pass.
- Bổ sung delivery gate đo trực tiếp rendered video ↔ timeline. Gate đã bắt đúng output Tuân Tiên cũ lệch **−33,237s** thay vì đóng gói nhầm.
- Đã re-render và QA lại Tuân Tiên sau repair: video **235,266667s**, audio **235,266009s**, drift so với target khoảng **−0,003s**; static/final verdict `pass`, policy 2, 0 block/repair/manual-review, contact sheet mới đã sinh.
- Delivery thực tế cuối: **235,267s, 1920×1080, 30fps, qa=pass**. Integration sau gate cuối: **1 pass, 0 fail**.
- Manifest delivery đã sửa phép đếm `slide.image`: **84 reference / 82 unique (97,62%)** sau hai brightness repair có lý do trong QA journal; vẫn 0 within-scene/adjacent duplicate. Repair tương lai không còn được chọn lại ảnh đã dùng qua `slide.image`.

### 2026-08-08 — Typography theo theme + dọn nhiễu verdict QA

Xuất phát từ báo cáo "chất lượng Lite kém, QA thường thất bại". Đo lại toàn bộ 52 proxy report
đang lưu: chỉ 2 report là `lite-v2`, và **100% finding của cả hai đến từ đúng một check `hero`**
(8 và 5). Không có check nào khác fail.

**Typography (nguyên nhân chất lượng, không phải QA).** Ba style profile pin cứng
`fonts: { title: BeVietnamPro, body: BeVietnamPro }`, `generateProjectTimeline` ghi vào
`defaults.fonts`, mà `createTemplateTheme.resolveFont()` đọc `defaults.fonts` **trước**
library theme. Hệ quả: mọi phim Lite chỉ có **1 typeface**, trong khi mọi phim template-tier
có 3 — tên cô dâu chú rể đặt cùng font sans với body copy, còn display face và script accent
của theme không bao giờ được dùng. Đã bỏ `fonts` khỏi cả ba profile và bỏ dòng ghi
`defaults.fonts`; `libraryTheme` giờ cấp typography, đúng đường mà template tier đã đi.
Đo lại trên `tuan-tien-725c` sau khi sinh lại timeline: **1 font → 3**
(CormorantGaramond ×3, BeVietnamPro ×4, Allura ×1). Ba profile chạm ba display face khác nhau.
Font display rộng hơn sans nên xuất hiện 2 `text_overflow` mới — preflight glyph-fit xử lý hết
trong 1 pass, verdict cuối `pass`, 0 actionable.

**Verdict QA (nguyên nhân "thất bại").** `qaProxy` tính `verdict = problems.length ? "review" : "ok"`
hoàn toàn mù tier, trong khi policy Lite đặt `hero: warn`. Một job Lite sạch vẫn in
`verdict=review`. Nay `qaProxy` nhận `--tier`, ghi thêm khối `policy` và in
`lite verdict=pass (5 finding(s): 5 warn)` kèm action từng dòng; `--strict` gate theo policy khi
biết tier, giữ nguyên nghĩa cũ khi không. Trường `verdict` **giữ nguyên** là phép đo thô vì
report đã lưu và `liteQualityReport` đang đọc nó. `qaLoop` truyền `--tier` xuống.

**Check `hero` sai về mặt thống kê.** Điều kiện cũ `heroScore < median` đúng với một nửa album
theo định nghĩa — 39/83 ảnh ở 725c, 5/7 hero slot bị flag. Đổi sang `HERO_WEAK_PERCENTILE = 0.25`
(nhóm 25% yếu nhất). Kèm một bug thật: `used` dựng một lần trước vòng lặp và không cập nhật nên
4/5 đề xuất trỏ về **cùng một file**; ở premium (`hero: repair`) qaLoop áp cả report trong một
pass sẽ đặt một ảnh vào 4 slide. Nay mỗi đề xuất claim ảnh của nó.

Kiểm chứng: `test:unit` **441 pass, 0 fail** (baseline trước thay đổi 432), `test:api`
**134 pass, 0 fail**, `typecheck` pass, `docs:check` pass (20 file). Test mới:
`test/qa-verdict-policy.test.mjs` (8 test) và một test typography trong
`test/lite-style-profiles.test.mjs` khoá lại việc profile không được pin font.

**Chưa làm, đã biết:** repair `crop` khi không tìm được focus an toàn vẫn `set_fit: "contain"`
→ ảnh letterbox (s06, s15 của 725c); và `too_bright` không có đường sửa khi hero layer không
có `.motion`.

### 2026-08-08 (tiếp) — Card nhiều ảnh: `cardSlots` là tham số chết

`allocatePhotos` (scripts/lib/storyboard.mjs) nhận `cardSlots`, tính nó, truyền nó, và **không
bao giờ dùng**. Vòng lặp montage phía trên tự định lượng `wanted = round(surplus / 5)` rồi cho
mỗi montage `ceil(surplus / remaining)` — tổng đúng bằng surplus theo cấu trúc, lần nào cũng vậy.
Vòng lặp enrich card chạy sau đó luôn bắt đầu với `surplus = 0` và `break` ngay lập tức.

Đo lại trên `tuan-tien-725c` (37 scene, budget 82, surplus 45): 9 montage lấy trọn 45 ảnh,
`cardSlots = 11` không tiêu được ảnh nào, và **cả 10 card đều giữ đúng 1 ảnh**. Đó là lý do
8 layout hai-slot, 9 layout ba-slot và 4 layout bốn-slot của library không bao giờ tới được
Lite, dù album giàu ảnh đến đâu.

Sửa: thêm `CARD_SURPLUS_SHARE = 0.5` và reserve phần của card **trước khi** montage rút.
Montage vẫn giữ ưu tiên phần lớn hơn (starve montage chỉ đổi đơn điệu này lấy đơn điệu khác), và
vòng lặp remainder sẵn có vẫn trả lại cho montage phần card không tiêu hết — không ảnh nào bị kẹt.

Kết quả đo trên cùng job đó:

| | trước | sau |
|---|---|---|
| card | 10, **tất cả 1 ảnh** | 18 (7 một ảnh + **11 ba ảnh**) |
| image layer | 10 | **40** |
| ảnh/scene | `{1:28, 6:8, 7:1}` | `{1:21, 3:11, 5:1, 6:4}` |
| layout dùng | 8 | **16** |
| font | 1 | 3 |

Để so sánh: template-tier `white-weddings-editorial` có 33 image layer trên 34 scene.

Job photo-poor không đổi: `cardSlots = 0` nên `cardReserve = 0` và nhánh này là no-op —
có test khoá lại. Thay đổi nằm ở composer dùng chung nên **premium cũng hưởng**; template tier
đọc recipe JSON đã author nên không đi qua đường này.

Kiểm chứng: `test:unit` **443 pass, 0 fail**, `test:api` 134/134, `typecheck` pass,
`docs:check` pass. Hai test mới trong `test/storyboard.test.mjs` khoá cả hai chiều (card được
enrich khi giàu ảnh, và không đụng tới job nghèo ảnh) + assert mỗi card nhiều ảnh phải trỏ tới
layout có đúng số slot đó.

**Hồi quy cần biết:** nhiều ảnh trên màn hình hơn nghĩa là nhiều cover crop hơn, nên repair
`set_fit: "contain"` bắn 3 lần thay vì 2 (3/40 image layer bị letterbox, trước là 2/10). Tỉ lệ
tốt hơn nhưng số tuyệt đối tăng — càng củng cố lý do phải xử lý defect letterbox.

**Không phải do thay đổi này:** `test:integration` đang đỏ ở `photo_coverage` (fixture 4 ảnh /
18s, 3/4 ảnh tới được phim = 75% < floor 85%). Đã kiểm chứng bằng cách revert riêng
`storyboard.mjs` về HEAD — lỗi y hệt. File test đó đang có 10 dòng sửa dở của một session khác.

### 2026-08-08 (tiếp) — "Letterbox" hoá ra là lệch orientation + skin blob giả làm mặt

Đo 3 layer bị `set_fit: "contain"` thì thấy đây không phải letterbox mà là **ảnh lọt thỏm trong
slot**: một ảnh dọc (AR 0,67) ngồi trong banner ngang AR 3,93 của `stacked_horizon_trio`, sau khi
contain chỉ còn phủ **17% diện tích slot** — 83% còn lại là nền. Hai ca kia 40% và 56%.

**Nguyên nhân 1 — 104/104 photo slot của library không khai báo `orient`.** Solver có đầy đủ máy
móc orientation (lọc chặt, `hardness()` ưu tiên slot bị ràng buộc +5000, và fallback khi album
không đủ nguồn) nhưng chưa bao giờ được cấp ràng buộc: `slot.orient || "any"` luôn ra `"any"`.
Thêm `impliedSlotOrient()` suy ra orientation từ chính hình dạng slot (ngưỡng AR 1,25 — chọn theo
chi phí thật: ảnh 3:2/2:3 đặt sai chiều vào slot AR `a` chỉ phủ ~`0,67/a`, xuống dưới 55% khi `a`
vượt ~1,22). Recipe tự khai `orient` vẫn thắng; đây chỉ lấp chỗ trống.

**Nguyên nhân 2 — skin blob được coi là mặt không được cắt.** `analyzePhotos.mjs:199` đóng dấu
`confidence: 0.35` lên bounding box của vùng da khi detector **không tìm thấy gì**
(`faceDetection: "skin_estimate_fallback"`), còn `scoreThreshold` của detector là 0,5 — nên
không detection thật nào có thể dưới 0,5. Guard `DEGENERATE_FACE_AXIS = 0.9` sẵn có chỉ chặn box
phủ gần trọn một trục; các blob này cao 0,73–0,80 nên lọt qua và được thi hành như mặt thật.
Thống kê trên album 83 ảnh: 9 box dưới 0,5 có **chiều cao trung bình 0,76 khung**, 189 box từ 0,5
trở lên có **0,10** — chênh 7,6 lần, và cả 7 box cao hơn nửa khung đều thuộc nhóm dưới 0,5. Thêm
`FACE_CONFIDENCE_MIN = 0.5`: box confidence thấp vẫn là **gợi ý focus** tốt, nhưng không được
quyền cấm cắt.

Kết quả trên hai job Lite thật:

| | 725c trước | 725c sau | tuan-tien-lite sau |
|---|---|---|---|
| `fit=contain` (ảnh lọt thỏm) | 3 | **0** | **0** |
| lệch orientation | 40 | **0** | **0** |
| mặt THẬT bị crop cắt | — | **0** / 35 layer có mặt thật | **0** |
| image layer | 10 | 40 | 42 |
| card theo số ảnh | `{1:10}` | `{1:7, 3:11}` | `{1:10, 2:1, 3:10}` |
| font | 1 | 3 | 3 |

Kiểm chứng an toàn quan trọng nhất: **0 khuôn mặt thật bị cắt** trên cả hai job — chỉ các ràng
buộc giả bị gỡ. Một ca (`s10` của 725c, `s29` của lite) giờ được sửa bằng chỉnh focus thay vì
contain, tức là repair đúng loại chứ không phải bỏ qua.

`test:unit` **444 pass, 0 fail**, `test:api` 134/134, `typecheck` + `docs:check` pass. Test mới
khoá cả hai chiều: cùng một box hình học, confidence 0,35 không được cấm cắt còn 0,88 thì được;
và slot 3,93:1 phải đòi `landscape` trong khi recipe tự khai vẫn thắng.

### 2026-08-08 (tiếp) — `too_bright`: phép đo sai chỗ, repair sai công cụ

Ba scene `too_bright` đi hết vòng QA mà không sửa được rồi ship `delivered_with_flags`. Truy ra
**hai lỗi chồng nhau**, và cái quan trọng hơn nằm ở phép đo.

**Phép đo.** Comment của chính `qaClip` nói đúng ý định — "a closing card is cream by design;
measuring its exposure and calling it too bright grades the art director, not the photo" —
nhưng `showsPhoto()` là nhị phân. Card Lite là rect kem `#FBF6ED` (luma ~246) phủ **100% khung**
với ảnh lồng vào 30–50%; đo cả khung thì thiết kế vượt ngưỡng chứ ảnh thì không, và không repair
nào lay chuyển được vì ảnh chưa bao giờ là thứ bị sáng. Nay `qaClip` cắt theo đúng hình chữ nhật
của ảnh (`crop=w:h:x:y` trước `signalstats`) — hình học timeline đã có sẵn. Đo trên **render thật**
với ảnh cưới sáng nhất album (meanLuma 221,6):

```
WHOLE 241,99  -> too_bright  (hành vi cũ, không sửa được)
PHOTO 219,15  -> không flag  (hành vi mới, đúng)
```

**Repair.** Cách cũ đổi ảnh hero, và nó gần như không bao giờ chạy: đòi layer có `.motion`
(montage và slide một ảnh không có layer nào, ảnh trong card cũng không cần chuyển động) **và**
đòi ảnh thay thế cùng orientation **chưa dùng** — mà phim Lite tiêu hết cả album nên
`!used.has(file)` sai với mọi ảnh. Thay bằng chỉnh phơi sáng (`lib/exposureRepair.mjs`): đúng
công cụ cho đúng vấn đề, chạy được với mọi loại scene và ở mọi mức coverage, và không phá bài
toán gán ảnh mà solver đã giải theo ràng buộc trùng lặp/kề nhau.

Ba điều phải làm đúng, phát hiện bằng đo chứ không suy luận:

1. **Grade phải đặt đúng chỗ.** `buildSlideArgs` return sớm cho `layer_scene`, trước bộ lọc màu
   cấp slide — nên `buildLayerSceneCommand` áp `layer.grade` và **không bao giờ đọc `slide.color`**.
   Grade cấp slide trên card sẽ ghi vào timeline, hợp lệ với schema, và không có tác dụng gì.
   Repair đặt grade đúng nơi qaClip đã đo.
2. **Contrast và brightness phải giải cùng nhau.** `eq` là `out = (in−0,5)·contrast + 0,5 + brightness`
   — contrast xoay quanh **midpoint** nên trên frame lệch tâm nó kéo cả mean. Tính độc lập thì hai
   thứ đánh nhau: frame đo 232 quay lại **252** sau `brightness −0,08, contrast 1,4`, sáng hơn lúc
   đầu. Và khi frame vừa cháy vừa phẳng thì **phơi sáng thắng**: độ phẳng là hệ quả của clip, kéo
   contrast chỉ đẩy mean ra xa hơn mức brightness bị chặn có thể kéo về.
3. **Phải hội tụ, không thể tính một phát.** Brightness phản hồi **phi tuyến** trên ảnh đã clip —
   pixel bão hoà ghim ở trắng và không nhúc nhích. Đo thật: hệ số phản hồi ~96/255. Nên khoá
   fix-once của `frame_brightness` được nới theo từng revision (chỉ riêng nó): mỗi lượt đọc lại
   frame như nó đang render và giải lại. Không thể dao động như pacing vì mỗi bước cục bộ trong
   một scene và bị chặn bởi revision cap.

Chạy trọn vòng `qaLoop` có render trên ảnh cưới thật bị ép cháy sáng:

```
revision 1: layer 1 brightness 0.120 -> 0.043 (yavg 231.7)
revision 2: layer 1 brightness 0.043 -> -0.005 (yavg 224.2)
clean: both QA layers pass   -> yavg cuối 215.2
```

`test:unit` **459 pass, 0 fail** (chạy 3 lần liên tiếp đều xanh — một assertion biên mỏng trong
test mới đã bị siết lại sau khi nó flaky một lần), `test:api` 134/134, `typecheck` + `docs:check`
pass. Test mới: `test/exposure-repair.test.mjs` (11 test, khoá cả tương tác contrast×brightness
và việc trừ lại grade đã áp khi đo) và `test/frame-brightness-region.test.mjs` (4 test, dựng
video tổng hợp bằng ffmpeg nên nhanh và tất định).

**Đã sửa 2026-08-19:** `slide.color` trước đây bị `layer_scene` bỏ qua dù schema và
`compileTimeline` đều hứa hẹn nó. Renderer nay áp grade và letterbox sau khi compositing toàn
card; có command regression và render probe thật với grade `editorial_clean`.

**Đính chính cùng ngày:** probe `editorial_clean` chỉ chứng minh được nửa việc — profile này
không có `letterbox`, nên lần render đó chạy qua `eq`/`glow` chứ không chạm `drawbox`. Recipe
duy nhất bật letterbox là `cinematic-film-01` (2.39 → hai thanh đen 138px), cộng phim composed
premium theo theme `dark_film` qua `composedLooks.mjs`. Đã render probe 2.39 thật trên ảnh cưới:
**không thẻ nào trong 11 `layer_scene` của recipe đó bị cắt chữ** — biên hẹp nhất là 12px
(`collage_cluster_text`) và 32px (`full_bleed_quote`), đo bằng font metrics thật chứ không phải
ước lượng. Nhưng biên đó không do luật nào giữ: thanh đen nằm TRONG canvas nên qua được kiểm tra
bounds, nằm ngoài lề title-safe 5% (54px) nên qua được luật layout, và text vẫn "vừa ô của nó"
nên qua được cả `text_overflow`. Probe thứ hai đặt chữ ở đúng mép title-safe hợp lệ (y=970,
cao 56) render ra một khung **mất hẳn tên cô dâu chú rể** mà mọi gate đều xanh. Vì thế
`preflightTimeline` có thêm một luật: text layer nào có khối chữ chạm vào thanh đen thì render
dừng trước khi encode. Luật xét khối chữ chứ không xét ô chứa (nhiều thẻ đang chạy có ô thò vào
thanh trong khi dòng chữ nằm cao hơn hẳn), và không tính caption — caption cố ý vẽ SAU thanh đen
để đọc như phụ đề phim.

**Và grade `layer_scene` giờ có chốt nhìn vào pixel.** `test/release/render-smoke.test.mjs`
thêm một thẻ `layer_scene` mang trọn bộ grade (LUT 3D + glow + vignette + grain + thanh 2.39),
rồi đọc lại khung đã encode: các hàng trong thanh phải đen, giữa thẻ phải không đen. Nền thẻ cố
tình để sáng — thẻ tối thì thanh đen lẫn với nền và assertion không chứng minh được gì. Đã thử
gỡ dây nối grade ra: test đỏ đúng chỗ (hàng 2 đọc 235 thay vì 16).
