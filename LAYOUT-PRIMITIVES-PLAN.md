# Kế hoạch: phá thế đơn điệu hình học của layout library

> Trạng thái: **ĐỀ XUẤT — chưa động vào repo.** Mọi con số trong tài liệu này đo bằng chính
> `scripts/lib/lookResolver.mjs` trên cây làm việc ngày 2026-07-30, không phải ước lượng.
>
> Đặt ở thư mục gốc (cạnh `LOOKS-MIGRATION-PLAN.md`) chứ không phải `docs/`, vì
> `scripts/checkDocs.mjs` chỉ quét `docs/` và sẽ báo lỗi với mọi tên file `.mjs` chưa tồn tại —
> tài liệu này cố ý nhắc tới các file sẽ được tạo ở Pha 0-3.

---

## 1. Vấn đề, bằng số đo

Chạy resolver thật trên toàn bộ 24 recipe (233 scene `layer_scene`). Có hai trục đo độc lập:

1. **Nội dung key.** V1 chỉ nhìn photo slot; V2 nhìn photo + text + panel (kể cả `z`) +
   `background.type/slot`. Kế hoạch dùng V2.
2. **Phạm vi mẫu.** Không trộn ba tập khác nhau:

| Phạm vi V2 | Dùng để trả lời | Baseline |
|---|---|---|
| `catalog` = library ∪ layout đã resolve trong recipe | Pha 1 có thật sự thêm từ vựng hình học? | **49** key phân biệt |
| `authored` = 233 scene chính trong 24 recipe | Recipe hiện viết ra bao nhiêu hình học? | **48** key; 30 key bị ≥2 recipe dùng lại |
| `reachable` = scene chính ∪ `muteFallback` ∪ repeatable variants | Khi chạy thật, key nào còn bị dùng quá rộng? | **7** key bị >12 recipe dùng chung: 23, 15, 15, 14, 14, 13, 13 |

Trong `shared`, `maxShare` và `over12Count`, một recipe chỉ được tính **một lần cho mỗi key** dù
key đó xuất hiện ở nhiều scene/variant; report occurrence vẫn liệt kê toàn bộ vị trí để migration
không bỏ sót.

V1 chỉ giữ làm nhật ký lịch sử: trên tập `authored` có **30** key, 25 key bị ≥2 recipe dùng lại,
8 key bị >12 recipe dùng chung (24, 23, 16, 15, 14, 14, 14, 13). Với V2 trên cùng tập
`authored`, các số tương ứng là **48 / 30 / 6** (23, 15, 14, 14, 14, 13).

Không phụ thuộc key: **5/233** scene có hình học khác layout gốc; **21/24** recipe có 0 scene như
vậy; **0** slot vượt canvas.

⚠️ **V1 mù với thiệp kết.** `closing_names` có **0 photo slot**, nên key V1 của nó là mảng rỗng —
giống hệt nhau ở mọi recipe **vĩnh viễn**, bất kể recipe đặt chữ khác nhau tới đâu. Đo lại bằng V2
thì nhóm `closing_names` dùng chung lớn nhất tụt từ 24 xuống **9** (11 key phân biệt), tức các
recipe *đã* dựng thiệp kết khác nhau, chỉ là V1 không thấy. `full_bleed_quote` (16 ở V1) cũng
rời khỏi nhóm >12 vì lý do tương tự.

Hệ quả bắt buộc: **mọi gate dùng V2 và ghi rõ phạm vi**. Nếu dùng V1, mục tiêu "không key nào
>12 recipe" là bất khả thi về mặt toán học — không `layoutOverrides` nào chạm được vào một key
rỗng, và không primitive nào ở Pha 1 là layout 0 ảnh để thiệp kết chuyển sang. Nếu đếm primitive
mới nhưng chỉ quét `authored`, Pha 1 cũng không thể làm 48 tăng: chưa recipe nào tham chiếu chúng.

5 scene ngoại lệ: `cinematic-film-01/s83_gallery_matte` (1), `white-weddings-full-01` (1),
`jmii-silk-botanical-01` (3).

**Nguyên nhân gốc.** Bài test cross-recipe (`test/template-recipes.test.mjs:120`) đòi hai recipe
bất kỳ khác nhau ≥2/3 số composition, nhưng "composition" là `resolvedSignature`, mà
`geometryOf()` ([lookResolver.mjs:63-73](scripts/lib/lookResolver.mjs#L63-L73)) gộp cả
`frame` và `photoTreatment` vào chữ ký. Đổi màu viền + độ bão hoà là **đủ** để hai recipe
được tính là hai bức ảnh khác nhau. Đợt "cross-recipe pass 2026-07-30" vì thế đẩy 87→247 look
mà hình học không nhúc nhích một pixel.

Đây không phải lỗi của ai — thước đo đo đúng thứ nó được thiết kế để đo. Nó chỉ không đo
hình học. Pha 0 sửa đúng chỗ đó trước, rồi mới thêm hình mới.

---

## 2. Mục tiêu & phạm vi

**Mục tiêu**

- G1 — Đo bằng **V2**, tách đúng phạm vi: Pha 1 tăng `catalogDistinct` từ **49 → ≥56**; Pha 2
  giảm `reachable` key bị >12 recipe dùng chung từ **7 xuống 0**. `authoredDistinct` giữ sàn 48
  ở Pha 0-1 rồi ratchet theo kết quả mô phỏng/rollout Pha 2, không đặt trước một đích thiếu dữ liệu.
- G2 — 23 recipe tự do sáng tạo có **≥3 scene** mang hình học khác layout gốc. Riêng
  `white-weddings-full-01` giữ sàn **≥1 scene** vì đây là bản dựng cam kết bám sát nguồn Canva.
- G3 — Bổ sung **4 họ cấu trúc** mà 25 layout hiện tại không có: chồng lớp có chiều sâu, chèn
  card trong ảnh full-bleed, medallion tròn, và bố cục chéo/lệch trục.
- G4 — Có thước đo chạy trong CI, bỏ qua nhiễu 1px nhưng nhận ra thay đổi bố cục có ý nghĩa và
  nhận riêng silhouette `circle`/`pill`, để lần sau không trượt về khác-grade-thôi.
  Kèm theo: thêm `offset_portrait_hero`, một cấu trúc 1 ảnh không chữ có host thật ở các scene
  `s83_gallery_matte`. Primitive này mở thêm lựa chọn bucket 1 cho Premium; Pha 2 vẫn phải đổi
  layout/override đủ recipe để hạ key 23×, không coi việc thêm library entry là đã migrate.

**Không làm trong kế hoạch này**

- Không đổi số slot của bất kỳ layout đang tồn tại (phá ngân sách ảnh của mọi job đang chạy).
- Không đụng `transitionGrammar`, nhạc, pacing, hay lớp AI director.
- Không mở `composeStoryboard` cho card 4/5 ảnh. Composer hiện chỉ phân bổ card 2/3 ảnh; nếu
  muốn đổi hành vi đó, phải làm một kế hoạch riêng có policy theo energy và test ngân sách ảnh.
- Không hỗ trợ bố cục **tràn viền** (bleed ngoài canvas) — xem §3.3, đó là việc riêng cần sửa engine.
- Không viết lại `geometryOf()` cho `resolvedSignature` (đổi chữ ký = đổi mọi cache/kiểm đang có);
  Pha 0 thêm thước đo **song song**, không thay thước cũ.

---

## 3. Ràng buộc kỹ thuật đã xác minh

### 3.1 Trần hình dạng của engine

Slot **luôn** là hình chữ nhật. Toàn bộ công cụ phá rectangle hiện có:

| Công cụ | Nơi định nghĩa | Giới hạn thật |
|---|---|---|
| `frame.radius` | [validateTimeline.ts:114](src/validateTimeline.ts#L114) | 0–400px, **một** bán kính cho cả 4 góc |
| `frame.border` / `borderColor` / `shadow` | [buildLayerSceneCommand.ts:133-136](src/buildLayerSceneCommand.ts#L133-L136) | border ≤200px |
| `slot.rotation` | [buildLayerSceneCommand.ts:137-139](src/buildLayerSceneCommand.ts#L137-L139) | độ, xoay quanh tâm ảnh |
| `scene.frameOverlay` | [layerSceneBuilder.mjs:118-124](scripts/lib/layerSceneBuilder.mjs#L118-L124) | PNG 1920×1080 đè lên ảnh, dưới text |

Hệ quả trực tiếp:

- **Tròn hoàn hảo** = slot vuông + `radius = width/2`, nên cạnh ≤ **800px** (vì cap 400).
- **Oval / viên thuốc** = slot chữ nhật + `radius = nửa cạnh ngắn`.
- **Arch mái vòm thật** (tròn trên, vuông dưới) = **không làm được** hôm nay. Layout tên
  `arch_trio` chỉ là 3 chữ nhật. Muốn arch thật: Pha 3, hoặc dùng `frameOverlay` PNG khoét lỗ.
- Không có polygon, clip-path, hay mask theo từng slot.

### 3.2 Xoay làm tràn khung khai báo

`rotate` xuất ra khung lớn hơn (`ow=rotw()`), nhưng overlay vẫn dán tại `x,y` thô
([buildLayerSceneCommand.ts:68-77](src/buildLayerSceneCommand.ts#L68-L77)) — nên ảnh xoay tràn
ra ngoài hộp đã khai báo và **preflight không kiểm phần tràn đó**. Công thức phải tự tính khi
thiết kế:

```
rotw = |w·cos θ| + |h·sin θ|        roth = |w·sin θ| + |h·cos θ|
yêu cầu: x + rotw ≤ 1920   và   y + roth ≤ 1080
```

Trị tuyệt đối là bắt buộc vì primitive dùng cả góc âm. Gate G7 trong
`scripts/validateLayoutPrimitive.mjs` kiểm công thức này trên library; `validateLook` kiểm lại
trên geometry đã resolve của từng recipe để override cũng không lọt.

### 3.3 Bẫy V4 ↔ preflight (nên vá kèm)

`validateLook` V4 cho phép một look đẩy slot ra ngoài canvas tới 50%
([lookResolver.mjs:289-298](scripts/lib/lookResolver.mjs#L289-L298)), nhưng preflight của engine
**ném lỗi cứng** với bất kỳ layer nào có `x<0`, `y<0`, hoặc vượt biên phải/dưới
([preflightTimeline.ts:138-146](src/preflightTimeline.ts#L138-L146)) → job chết với exit 1.

Hôm nay chưa recipe nào đạp mìn (đo được 0 slot tràn), nhưng Pha 2 sẽ nghịch bố cục lệch trục.
**Vá ở Pha 0**: siết V4 về đúng luật preflight (bất kỳ phần nào ra ngoài canvas = error), kiểm
thêm bounding box sau xoay, và sửa `meta.coordinateNote` trong `layouts/library.json` — metadata
đó hiện vẫn nói toạ độ âm là chủ ý dù test library và preflight đều cấm.

### 3.4 Ai đọc gì trong `layouts/library.json`

| Trường | Ai đọc |
|---|---|
| `id`, `background`, `photoSlots[*]`, `textSlots[*]`, `panels[*]`, `textRequired` | `layerSceneBuilder.mjs`, `lookResolver.mjs`, `templateRules.mjs`, `engineCapabilities.mjs` |
| `kind`, `intent`, `bestFor`, `durationRange` | **không ai** — chỉ tài liệu cho người |
| `decorSlots` | **không ai** (2 layout đang khai báo nhưng không render) — đừng dùng |

`describeCapabilities()` ([engineCapabilities.mjs:251-260](scripts/lib/engineCapabilities.mjs#L251-L260))
chỉ đẩy `id` + số ảnh + danh sách text-slot-id vào prompt AI. Viết `intent` hay tới đâu, AI
cũng không thấy.

`server/services/recipes.ts:43-50` parse library bằng zod nhưng `.passthrough()` và chỉ ràng
buộc `designTokens.themes` → **không cần sửa server/web** khi thêm primitive.

### 3.5 Toàn bộ cửa mà một primitive mới phải qua

| # | Cửa | Nguồn | Luật |
|---|---|---|---|
| G1 | Canvas | [test/library.test.mjs:19-35](test/library.test.mjs#L19-L35) + [preflightTimeline.ts:138](src/preflightTimeline.ts#L138) | mọi slot: `x,y ≥ 0`, `x+w ≤ 1920`, `y+h ≤ 1080` |
| G2 | Sàn diện tích slot | [thresholds.mjs:51-52](scripts/lib/rules/thresholds.mjs#L51-L52) | ≥8% canvas (layout <6 slot), ≥5% (≥6 slot) — **bỏ qua nếu có full-bleed bg** |
| G3 | Coverage scene | [thresholds.mjs:53-54](scripts/lib/rules/thresholds.mjs#L53-L54) | tổng ≥35%, hoặc ≥25% nếu `textRequired` — **bỏ qua nếu có full-bleed bg** |
| G4 | Safe margin | `meta.safeMargin = 70` | text slot nên nằm trong 70..1850 × 70..1010 (khuyến nghị) |
| G5 | Type scale — **KHÔNG phải luật toàn cục** | [template-recipes.test.mjs:196-210](test/template-recipes.test.mjs#L196-L210) | heading ≥68px / body ≥32px chỉ được kiểm cho **một** recipe: `long-distance-love-01`. Xem cảnh báo ngay dưới bảng. |
| G6 | Text không đè ảnh | [template-recipes.test.mjs:212-246](test/template-recipes.test.mjs#L212-L246) | nếu đè, ≥80% vùng đè phải có panel `z:"over_photos"` |
| G7 | Biên sau khi xoay | §3.2 | dùng trị tuyệt đối; kiểm cả primitive lẫn resolved look |
| G8 | Frame có tên | [templateTheme.mjs:48-54](scripts/lib/templateTheme.mjs#L48-L54) | `slot.frame` dạng string phải tồn tại trong `template.layoutPresets` **hoặc** `designTokens.framePreset` |
| G9 | Layout tồn tại | [test/recipe-engine-contract.test.mjs:34-47](test/recipe-engine-contract.test.mjs#L34-L47) | mọi `layer_scene` phải trỏ tới id có thật |
| G10 | Slot phải có id | [test/library.test.mjs:37-46](test/library.test.mjs#L37-L46) | — |

⚠️ **G5 từng bị chép nhầm thành luật toàn cục trong bản đầu của kế hoạch này.** Test đó nằm trong
`test("Across the Miles keeps one heading family and a readable type scale")` và bắt đầu bằng
`recipes.find(item => item.id === "long-distance-love-01")` — nó chỉ chạy trên đúng recipe đó.
Bằng chứng đo được trên cây hiện tại: **74/226** text slot có copy trên toàn bộ 24 recipe đang
dưới ngưỡng 68/32 mà suite vẫn xanh, và **12/25** layout gốc của library có text slot dưới ngưỡng
(`three_photo_row` 64px, `polaroid_feature` 60px, `save_date_card` 60/42px, …).

Vì vậy trong `validateLayoutPrimitive.mjs`, **G5 phải là warning, không phải error**. Nếu để G5
là error thì chạy validator trên chính library hiện tại được **12 pass / 13 fail** — toàn bộ 13
fail là G5 — và tiêu chí "25/25 pass" trở thành bất khả thi. Các text slot của bảy primitive
active ở §6.2 dùng 68–72px nên vẫn sạch dù G5 ở mức nào.

### 3.6 Bất biến không được phá

- **I1** — look chỉ được *trang điểm* slot, không thêm/bớt/đổi tên
  ([lookResolver.mjs:16-26](scripts/lib/lookResolver.mjs#L16-L26)). `photoDemand()` tính ngân sách
  ảnh từ `photoSlots.length`.
- **Thứ tự ưu tiên frame**: `scene.photoSlots[].frame` → `look.frame` → `slot.frame`
  ([layerSceneBuilder.mjs:98](scripts/lib/layerSceneBuilder.mjs#L98)). ⚠️ Recipe nào khai
  `look.frame` sẽ **đè chết** frame tròn của `circle_trio_stagger`. Với layout mà hình dạng *là*
  bản sắc, look phải đặt frame trong `layoutOverrides.photoSlots.<id>.frame`, không đặt `look.frame`.
- **Thứ tự vẽ**: background → panels (`z ≠ over_photos`) → photoSlots (theo thứ tự mảng, sau đè
  lên trước) → panels `over_photos` → `frameOverlay` → textSlots.

---

## 4. Quyết định kiến trúc: primitive mới hay `layoutOverrides`?

| Tình huống | Cách làm | Lý do |
|---|---|---|
| Đổi vị trí/kích thước slot, **giữ nguyên số slot**, chỉ cho 1 recipe | `looks[].layoutOverrides` | 0 thay đổi chia sẻ, 0 rủi ro cho recipe khác |
| Đổi **số** photo slot | Primitive mới | I1 cấm look đổi số slot |
| Cần cấu trúc panel/background mới (scrim, tint, full-bleed) | Primitive mới | look chỉ override được `background`, không override `panels` |
| Muốn ≥3 recipe dùng chung + muốn premium tự chọn | Primitive mới | đúng ngay với bucket 1/2/3; bucket 4/5 còn cần sửa allocator riêng |
| Muốn AI director hiểu ngữ nghĩa bố cục | **Không có cách nào** hôm nay | prompt chỉ nhận id + số ảnh + text-slot-id (§3.4) |

Kế hoạch này dùng **cả hai**: Pha 1 thêm primitive (mở trần hình học), Pha 2 dùng
`layoutOverrides` để mỗi recipe co giãn primitive theo tỉ lệ riêng (tạo phân biệt giữa các recipe).

---

## 5. Pha 0 — Dựng thước đo trước (~2–3h)

Làm trước tiên. Không có bước này, Pha 1-2 sẽ lại trôi về khác-grade-thôi và không ai biết.

### 5.1 Việc

- [ ] **0.1** Thêm `scripts/lib/geometrySignature.mjs`, export:
  ```js
  // KEY V2: photo slot + text slot + panel (gồm z) + background.type/slot. Lượng tử hoá x/width theo
  // 1% canvas ngang (19.2px), y/height theo 1% dọc (10.8px), rotation theo 1°. Bỏ id,
  // frame, grade và nội dung chữ — để đổi tên slot, đổi màu viền hay nudge 1px không
  // tạo "hình học mới". PHẢI gồm text slot: closing_names có 0 photo slot, nên key
  // chỉ-photo biến 24 thiệp kết khác nhau thành một key rỗng duy nhất (§1).
  export function geometryKey(resolvedLayout, canvas) // -> string
  // Silhouette chỉ phục vụ gate hình dạng: rect | circle | pill. Border/color/shadow
  // không tham gia; frame hiệu lực phải theo đúng precedence của layerSceneBuilder.
  export function slotShapeKey(resolvedScene, template, library) // -> string
  export function meaningfullyDiffers(resolvedScene, baseLayout, template, library, canvas) // -> boolean
  export function geometryStats(recipes, library)
  // -> { catalog, authored, reachable, perRecipe }; mỗi scope có distinct/shared/maxShare
  ```
- [ ] **0.2** Thêm `test/layout-geometry.test.mjs` với các ratchet có thể xanh ngay:
  1. `meaningful custom geometry không thụt lùi`: map baseline
     `cinematic-film-01:1`, `jmii-silk-botanical-01:3`, `white-weddings-full-01:1`, recipe khác
     là 0. Sau mỗi batch Pha 2, nâng chính recipe đã migrate lên 3; không đặt trước `N=1` cho
     21 recipe chưa được sửa.
  2. `reachable.maxShare ≤23` và `reachable.over12Count ≤7` ở Pha 0/Pha 1. Chỉ siết sau batch
     recipe làm số đo thực sự giảm; đích cuối lần lượt là 12 và 0.
  3. `catalog.distinct ≥49` và `authored.distinct ≥48` ở Pha 0; nâng riêng
     `catalog.distinct` lên 56 cuối Pha 1. `authored` chỉ ratchet từ Pha 2.
  4. Một test **chống hồi quy metric**: riêng `closing_names` phải giữ **11 key V2 phân biệt**
     và nhóm lớn nhất **≤9** trên 24 recipe. Nếu ai đó rút text slot khỏi key, con số tụt về 1;
     nếu vô tình đồng nhất hoá thiệp kết, ratchet 11/9 cũng bắt được.
  5. `reachable` phải thật sự quét union của scene chính, `muteFallback` và mọi repeatable
     variant; fixture có một key chỉ xuất hiện trong fallback/variant để chống việc quên hai nhánh này.
  Thêm unit cases cho helper: nudge 1px giữ nguyên key, dịch ≥1% tạo thay đổi meaningful,
  frame tròn khác rounded-rect, và rotation âm dùng bounding box đúng.
- [ ] **0.3** Vá bẫy §3.3: siết V4 về đúng biên canvas, thêm kiểm bounding box sau xoay bằng
  công thức §3.2, sửa comment và `meta.coordinateNote`.
- [ ] **0.4** Thêm `scripts/validateLayoutPrimitive.mjs` — chạy G1-G8 trên một file JSON ứng viên
  hoặc trên chính `layouts/library.json`. (Bản nháp đã chạy được, in ra bảng PASS/FAIL kèm % diện
  tích từng slot; sẽ dọn lại khi commit.) Thêm hai file mới vào `include` của
  `tsconfig.scripts.json` để `typecheck:scripts` thực sự kiểm chúng.
- [ ] **0.5** Chưa đưa `geometryCount` vào server/web ở pha này. CLI + CI là nguồn chuẩn duy
  nhất, tránh nhân đôi thuật toán và tránh import `.mjs` ngoài `dist/server`. Nếu product thật sự
  cần hiển thị metric, làm một PR riêng gồm `recipeSummarySchema`, fixture API,
  `apps/web/src/types.ts`, `RecipeLibrary.tsx`, i18n, `typecheck:server` và `typecheck:web`.

### 5.2 Nghiệm thu Pha 0

```powershell
node scripts/validateLayoutPrimitive.mjs layouts/library.json   # G1-G4,G6-G8 sạch; G5 chỉ warning
node scripts/lintStoryTemplates.mjs                             # 24 clean
node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs
npm run typecheck:scripts                                       # geometrySignature + validator
```

Trước merge, chạy thêm `npm run check` trên branch/worktree sạch; không dùng số failure của cây
đang bẩn làm ngân sách lỗi.

Triển khai trên branch/worktree sạch từ baseline dự định merge. Ghi vào PR description:
`catalogDistinct=49`; `authored=48 distinct / 30 shared`; `reachable=7 key >12 / maxShare=23`;
`meaningful=5 scene / 3 recipe`. Cuối mỗi pha sau, đối chiếu đúng các scope này, không gộp chúng
thành một con số “arrangement”. V1 chỉ nằm trong phụ lục lịch sử.

---

## 6. Pha 1 — Thêm 7 primitive có host (~3–4h)

Cả 7 primitive active phải chạy qua G1-G8 bằng validator. `circle_trio_stagger` có đúng một cảnh
báo dự kiến trước bước 1.1: preset `circleMedallion` chưa tồn tại. Hai ứng viên 4/5 ảnh không có host
được chuyển hẳn sang Pha 1b (§6.5), không merge và không tính vào G1.

### 6.1 Thêm frame preset trước

Vào `designTokens.framePreset` của [layouts/library.json](layouts/library.json):

```json
"circleMedallion": { "radius": 260, "border": 10, "borderColor": "#FFFFFF", "shadow": true }
```

`radius 260 = 520/2` → tròn tuyệt đối trên slot 520×520, và 260 ≤ cap 400. Tên mới không đụng
24 preset đang có trong các recipe (`reel_hairline`, `gold_mount`, `arbour_arch`, …).

### 6.2 Bảy primitive active (toạ độ ứng viên)

| id | ảnh | text | coverage | mỗi slot | họ cấu trúc | ghi chú |
|---|---|---|---|---|---|---|
| `overlap_stack_duo` | 2 | 1 | 51% | 33.9 / 16.7% | chồng lớp có chiều sâu | ảnh trước xoay -3°, đè lên ảnh sau |
| `inset_card_hero` | 2 | 0 | (bỏ qua, full-bleed) | 10.3% | card chèn trong full-bleed | inset có viền/shadow, không giả định có chữ |
| `circle_trio_stagger` | 3 | 1 | 39% | 13.0% ×3 | medallion tròn | cần `circleMedallion` |
| `diagonal_staircase_trio` | 3 | 1 | 37% | 12.4% ×3 | bậc thang chéo | text canh phải, góc trên phải |
| `golden_column_pair` | 2 | 1 | 58% | 44.6 / 13.7% | chia lệch tỉ lệ vàng | |
| `stacked_horizon_trio` | 3 | 0 | 61% | 20.3% ×3 | 3 dải cinemascope | không chữ, nhịp nghỉ |
| `offset_portrait_hero` | 1 | 0 | 47% | 46.6% | 1 ảnh lệch trái + accent dọc | host khớp các scene `s83_gallery_matte` không chữ |

`offset_portrait_hero` không nằm trong bốn họ cấu trúc mới của G3. Nó tồn tại vì key
`gallery_matte_hero` bị 23 recipe dùng chung và các host `s83_gallery_matte` được kiểm tra đều
**không có copy**. Bản cũ dành cả cột phải cho `heading`, nên khi gắn vào host thật sẽ để lại một
khoảng trống mang dáng “thiếu chữ”. Bản active bỏ text slot, tăng ảnh lên 46.6% canvas và dùng
một accent dọc làm đối trọng. Đây là từ vựng dùng lại được cho bucket 1; Pha 2 vẫn cần adoption
map và override riêng để tạo khác biệt giữa recipe.

<details>
<summary>JSON đầy đủ của 7 entry active (dán vào mảng <code>layouts</code>)</summary>

```json
{
  "id": "overlap_stack_duo",
  "kind": "layer_scene",
  "intent": "Ảnh lớn phía sau, ảnh nhỏ nghiêng đè lên góc dưới phải — chiều sâu, không phải lưới.",
  "bestFor": "khoảnh khắc có lớp lang: hậu trường + chân dung, trước/sau",
  "background": { "type": "cream" },
  "photoSlots": [
    { "id": "back",  "x": 180, "y": 110, "width": 900, "height": 780, "fit": "cover", "suggestedAnimation": "fade" },
    { "id": "front", "x": 880, "y": 430, "width": 620, "height": 560, "fit": "cover", "rotation": -3, "suggestedAnimation": "slide_up" }
  ],
  "textSlots": [
    { "id": "heading", "role": "heading", "x": 1160, "y": 140, "width": 640, "height": 200,
      "align": "left", "fontRole": "heading", "sizePx": 72 }
  ],
  "durationRange": [4.5, 6]
},
{
  "id": "inset_card_hero",
  "kind": "layer_scene",
  "intent": "Ảnh full-bleed làm nền, một card nhỏ chèn góc dưới phải như ảnh ghim.",
  "bestFor": "cảnh chính + chi tiết phụ (nhẫn, hoa, thiệp)",
  "background": { "type": "photo_full_bleed", "slot": "bg" },
  "photoSlots": [
    { "id": "bg",    "x": 0,    "y": 0,   "width": 1920, "height": 1080, "fit": "cover" },
    { "id": "inset", "x": 1180, "y": 620, "width": 560,  "height": 380,  "fit": "cover",
      "frame": { "border": 12, "borderColor": "#FFFFFF", "shadow": true },
      "suggestedAnimation": "slide_up" }
  ],
  "durationRange": [5, 7]
},
{
  "id": "circle_trio_stagger",
  "kind": "layer_scene",
  "intent": "Ba medallion tròn lệch tầng trên nền cream, heading dưới chân.",
  "bestFor": "chân dung gia đình, ba khoảnh khắc song song",
  "background": { "type": "cream" },
  "photoSlots": [
    { "id": "p1", "x": 120,  "y": 90,  "width": 520, "height": 520, "fit": "cover", "frame": "circleMedallion", "suggestedAnimation": "slide_up" },
    { "id": "p2", "x": 700,  "y": 280, "width": 520, "height": 520, "fit": "cover", "frame": "circleMedallion", "suggestedAnimation": "fade" },
    { "id": "p3", "x": 1280, "y": 90,  "width": 520, "height": 520, "fit": "cover", "frame": "circleMedallion", "suggestedAnimation": "slide_down" }
  ],
  "textSlots": [
    { "id": "heading", "role": "heading", "x": 96, "y": 850, "width": 1728, "height": 150,
      "align": "center", "fontRole": "heading", "sizePx": 72 }
  ],
  "durationRange": [4.5, 6]
},
{
  "id": "diagonal_staircase_trio",
  "kind": "layer_scene",
  "intent": "Ba ảnh tụt chéo từ trên trái xuống dưới phải, chữ nằm ở khoảng trống góc trên phải.",
  "bestFor": "hành trình, tiến triển thời gian",
  "background": { "type": "cream" },
  "photoSlots": [
    { "id": "top", "x": 110,  "y": 80,  "width": 560, "height": 460, "fit": "cover", "suggestedAnimation": "slide_right" },
    { "id": "mid", "x": 680,  "y": 310, "width": 560, "height": 460, "fit": "cover", "suggestedAnimation": "fade" },
    { "id": "low", "x": 1250, "y": 540, "width": 560, "height": 460, "fit": "cover", "suggestedAnimation": "slide_left" }
  ],
  "textSlots": [
    { "id": "heading", "role": "heading", "x": 1250, "y": 120, "width": 560, "height": 190,
      "align": "right", "fontRole": "heading", "sizePx": 68 }
  ],
  "durationRange": [5, 6.5]
},
{
  "id": "golden_column_pair",
  "kind": "layer_scene",
  "intent": "Một ảnh lớn chiếm 2/3 trái, một ảnh cao hẹp bên phải, chữ dưới cột hẹp.",
  "bestFor": "cảnh chính + chân dung phụ, bố cục tạp chí",
  "background": { "type": "cream" },
  "photoSlots": [
    { "id": "major", "x": 110,  "y": 100, "width": 1050, "height": 880, "fit": "cover", "suggestedAnimation": "fade" },
    { "id": "minor", "x": 1210, "y": 250, "width": 490,  "height": 580, "fit": "cover", "suggestedAnimation": "slide_left" }
  ],
  "textSlots": [
    { "id": "heading", "role": "heading", "x": 1210, "y": 870, "width": 600, "height": 120,
      "align": "left", "fontRole": "heading", "sizePx": 68 }
  ],
  "durationRange": [5, 6.5]
},
{
  "id": "stacked_horizon_trio",
  "kind": "layer_scene",
  "intent": "Ba dải ngang cinemascope xếp chồng — ba đường chân trời, không chữ.",
  "bestFor": "phong cảnh, chuyển chương, nhịp thở",
  "background": { "type": "cream" },
  "photoSlots": [
    { "id": "band1", "x": 180, "y": 80,  "width": 1560, "height": 270, "fit": "cover", "suggestedAnimation": "slide_right" },
    { "id": "band2", "x": 180, "y": 400, "width": 1560, "height": 270, "fit": "cover", "suggestedAnimation": "slide_left" },
    { "id": "band3", "x": 180, "y": 720, "width": 1560, "height": 270, "fit": "cover", "suggestedAnimation": "slide_right" }
  ],
  "durationRange": [4, 5.5]
},
{
  "id": "offset_portrait_hero",
  "kind": "layer_scene",
  "intent": "Một ảnh chân dung lớn lệch trái, cân bằng bằng một accent dọc mảnh — không giả định có chữ.",
  "bestFor": "chân dung đơn, khoảnh khắc lặng không lời",
  "background": { "type": "cream" },
  "photoSlots": [
    { "id": "hero", "x": 140, "y": 80, "width": 1050, "height": 920, "fit": "cover", "suggestedAnimation": "fade" }
  ],
  "panels": [
    { "x": 1230, "y": 160, "width": 18, "height": 760, "color": "theme.accent", "opacity": 0.55 }
  ],
  "durationRange": [4.5, 6]
}
```
</details>

### 6.3 Tác động thật lên Premium — bucket 1/2/3

`composeStoryboard` chọn layout bằng rotor round-robin theo **bucket số ảnh**
([storyboard.mjs:246-248](scripts/lib/storyboard.mjs#L246-L248)), nhưng `allocatePhotos()` hiện
chỉ làm giàu card bằng size `[3, 2]`
([storyboard.mjs:176-180](scripts/lib/storyboard.mjs#L176-L180)). `pickLayoutSize()` có cap 4,
nhưng đường phân bổ card bình thường không tạo `want=4`; montage đi sang effect riêng.

| bucket | library trước → sau | Premium tự chọn hôm nay | ghi chú |
|---|---:|---|---|
| 1 ảnh | 6 → **7** | **có** | rotor nhận thêm `offset_portrait_hero` |
| 2 ảnh | 5 → **8** | **có** | rotor nhận thêm `overlap_stack_duo`, `inset_card_hero`, `golden_column_pair` |
| 3 ảnh | 6 → **9** | **có** | rotor nhận thêm `circle_trio_stagger`, `diagonal_staircase_trio`, `stacked_horizon_trio` |
| 4 ảnh | 4 → **4** | **không từ allocator hiện tại** | không đổi ở Pha 1 |
| 5 ảnh | 0 → **0** | **không** | không đổi ở Pha 1 |
| 6/8/9 ảnh | 1/1/1 → 1/1/1 | montage/effect riêng | không đổi |

Tác động runtime tự động của Pha 1 vì thế chỉ là rotor 1/2/3 ảnh có thêm lựa chọn. Vẫn phải
dry-run §9.2 để bảo đảm số scene và nhịp card không đổi ngoài danh sách layout, nhưng **không**
kỳ vọng scene 4/5 ảnh xuất hiện. Mở Premium cho 4/5 ảnh là ngoài phạm vi kế hoạch này.

📌 Sự thật kèm theo, đo được chứ không suy đoán: **bucket 4 đã chết sẵn từ trước kế hoạch này.**
Bốn layout 4 ảnh đang nằm trong library (`hero_title_card`, `invitation_row`, `quad_grid_caption`,
`save_date_card`) chưa từng được Premium tự chọn, vì `sizes = [3, 2]` chặn ở trên và
`pickLayoutSize` đi xuống từ `Math.min(want, 4)`. Vì vậy không đưa primitive 4/5 ảnh vào Pha 1
khi chưa có host hoặc allocator tương ứng.

### 6.4 Thứ tự làm

- [ ] **1.1** Thêm frame preset `circleMedallion` (§6.1).
- [ ] **1.2** Thêm 7 entry active vào mảng `layouts`, **cuối mảng** (thứ tự mảng ảnh hưởng rotor
      `createRotor(ids, ids[0])`; chèn giữa sẽ xáo trộn phim premium hiện có ngoài ý muốn).
- [ ] **1.3** `node scripts/validateLayoutPrimitive.mjs layouts/library.json` → 32 layout, không
      lỗi G1-G4/G6-G8 (G5 vẫn warning trên 13 layout cũ, xem §3.5).
- [ ] **1.4** Chạy targeted geometry/layout/template tests; tất cả phải pass.
- [ ] **1.5** Nâng `catalogDistinct` V2 từ 49 lên ≥56. Giữ `authoredDistinct ≥48`,
      `reachable.maxShare ≤23` và `reachable.over12Count ≤7`: chưa recipe nào được migrate.
- [ ] **1.6** Render probe (§9.3) — mắt người nhìn từng layout mới một lần, trước khi wire vào recipe.

### 6.5 Pha 1b — hai ứng viên bị hoãn

`offset_quad_pinwheel` và `filmstrip_band` **không thuộc Pha 1**. Chỉ mở Pha 1b khi một trong hai
điều kiện có thật: recipe mới/cũ có scene tương thích sẽ dùng primitive, hoặc allocator Premium
được mở có chủ đích cho card 4/5 ảnh kèm test ngân sách ảnh. Khi đó mỗi primitive phải có ≥2 host
trong adoption plan; nếu không đạt thì tiếp tục để ở tài liệu, không merge vào library.

<details>
<summary>JSON ứng viên Pha 1b (không dán ở Pha 1)</summary>

```json
[
  {
    "id": "offset_quad_pinwheel",
    "kind": "layer_scene",
    "intent": "Bốn ảnh kích thước lệch nhau xoay nhẹ quanh tâm — chong chóng, không phải lưới 2x2.",
    "bestFor": "montage cảm xúc, nhịp nghỉ không chữ",
    "background": { "type": "cream" },
    "photoSlots": [
      { "id": "q1", "x": 150,  "y": 110, "width": 620, "height": 480, "fit": "cover", "rotation": -4, "suggestedAnimation": "fade" },
      { "id": "q2", "x": 1020, "y": 90,  "width": 560, "height": 520, "fit": "cover", "rotation": 3,  "suggestedAnimation": "fade" },
      { "id": "q3", "x": 230,  "y": 600, "width": 560, "height": 400, "fit": "cover", "rotation": 5,  "suggestedAnimation": "fade" },
      { "id": "q4", "x": 1100, "y": 590, "width": 640, "height": 400, "fit": "cover", "rotation": -3, "suggestedAnimation": "fade" }
    ],
    "durationRange": [4, 5.5]
  },
  {
    "id": "filmstrip_band",
    "kind": "layer_scene",
    "intent": "Năm dải dọc full-height sát nhau như một cuộn phim đứng.",
    "bestFor": "montage nhịp nhanh, nhiều ảnh dọc",
    "background": { "type": "cream" },
    "photoSlots": [
      { "id": "s1", "x": 95,   "y": 90, "width": 330, "height": 760, "fit": "cover", "suggestedAnimation": "slide_up" },
      { "id": "s2", "x": 445,  "y": 90, "width": 330, "height": 760, "fit": "cover", "suggestedAnimation": "slide_up" },
      { "id": "s3", "x": 795,  "y": 90, "width": 330, "height": 760, "fit": "cover", "suggestedAnimation": "slide_up" },
      { "id": "s4", "x": 1145, "y": 90, "width": 330, "height": 760, "fit": "cover", "suggestedAnimation": "slide_up" },
      { "id": "s5", "x": 1495, "y": 90, "width": 330, "height": 760, "fit": "cover", "suggestedAnimation": "slide_up" }
    ],
    "textSlots": [
      { "id": "heading", "role": "heading", "x": 96, "y": 880, "width": 1728, "height": 130,
        "align": "center", "fontRole": "heading", "sizePx": 68 }
    ],
    "durationRange": [4, 5.5]
  }
]
```
</details>

---

## 7. Pha 2 — Mỗi recipe co giãn primitive theo tỉ lệ riêng (~6–10h)

Pha 1 mở trần. Pha 2 mới là chỗ con số "24 recipe chung 1 hình học" tụt xuống.

> **P1.7R supersedes các toạ độ Pha 2 cũ.** Probe ảnh cưới thật đã sửa
> `stacked_horizon_trio`, `offset_portrait_hero`, `diagonal_staircase_trio` và thêm frame nội tại
> cho `overlap_stack_duo`. Mọi adoption/override bên dưới phải qua guard §7.2; map được rebase có
> 70 adoption vì `four-seasons-love-01/s03_autumn` xử lý thêm group `paper_collage` còn share 13.

### 7.1 Pilot (làm trước, 3 recipe)

Ba recipe pilot dưới đây lấy từ snapshot ứng viên đã quét (§7.4) — mọi dòng đều cùng photo
demand và tương thích text-slot trên toàn bộ đường chạy, nên hoán đổi được mà không đụng solver:

| Recipe | Scene thay | Đang dùng | Chuyển sang | Vì sao hợp |
|---|---|---|---|---|
| `cinematic-film-01` | `s08c_breather` | `arch_trio` (3 ảnh portrait, không chữ) | `circle_trio_stagger` | ảnh dọc hợp medallion; không dùng dải ngang cho portrait |
| | `s84_photo_duo` | `photo_duo` (2 ảnh, không chữ) | `overlap_stack_duo` | cùng 2 ảnh → ngân sách không đổi |
| | `s83_gallery_matte` | `gallery_matte_hero` (1 ảnh) | `offset_portrait_hero` | hạ key 23× |
| `jmii-silk-botanical-01` | `s05_arch_gallery` | `arch_trio` (3 ảnh, không chữ) | `circle_trio_stagger` | medallion tròn hợp lụa/thực vật |
| | `s11_side_by_side` | `photo_duo` (2 ảnh, không chữ) | `golden_column_pair` | |
| | `s85_paper_collage` | `polaroid_scatter` (3 ảnh, không chữ) | `diagonal_staircase_trio` | |
| `editorial-bold-01` | `s85_arch_trio` | `polaroid_scatter` (3 ảnh, không chữ) | `diagonal_staircase_trio` | chất tạp chí, lệch trục |
| | `s84_photo_duo` | `duo_tinted_spread` (2 ảnh, không chữ) | `inset_card_hero` | |
| | `s83_gallery_matte` | `gallery_matte_hero` (1 ảnh) | `offset_portrait_hero` | |

`s03_chapter` của `editorial-bold-01` **không** nằm trong danh sách: nó đang cấp copy cho hai text
slot của `three_photo_row`, mà `diagonal_staircase_trio` chỉ có một slot `heading` — xem luật
tương thích chữ ngay dưới.

⚠️ **Hoán đổi layout làm MẤT CHỮ trong im lặng nếu text slot không khớp.**
`buildLayerSceneFromLayout` chỉ duyệt `layout.textSlots` rồi tra `scene.text[slot.id]`
([layerSceneBuilder.mjs:127-135](scripts/lib/layerSceneBuilder.mjs#L127-L135)) — mọi key trong
`scene.text` mà layout mới không có sẽ bị **bỏ qua không báo lỗi, không cảnh báo, lint vẫn xanh**.
Luật hoán đổi vì thế có hai vế, không phải một: **cùng số ảnh** *và* **union text key của scene
chính + `muteFallback` + mọi repeatable variant ⊆ tập text slot id của layout mới**. Snapshot
§7.4 chỉ để đọc; `--check-plan` ở §7.3 phải tính lại điều kiện này từ source.

⚠️ Ba scene `s83/s84/s85` là đuôi gallery co giãn, có test riêng bắt mỗi recipe phải sở hữu một
chuỗi signature `s83 > s84 > s85` **duy nhất**
([template-recipes.test.mjs:136-150](test/template-recipes.test.mjs#L136-L150)). Hoán đổi ở đây
được phép và đúng chỗ — phần lớn key 13–15× nằm chính tại đây — nhưng hai recipe không được cùng
nhận một bộ ba giống nhau.

⚠️ **Đổi layout = đổi ngân sách ảnh.** `photoDemand()` đọc `photoSlots.length`
([engineCapabilities.mjs:196-207](scripts/lib/engineCapabilities.mjs#L196-L207)); một scene 3 ảnh
chuyển sang layout 4 ảnh làm lệch solver, và nếu scene đó có `muteFallback` thì fallback phải
**cùng số ảnh** ([templateRules.mjs:243](scripts/lib/rules/templateRules.mjs#L243)). Quy tắc Pha 2:
**chỉ hoán đổi giữa các layout cùng số ảnh**. Pha 2 không có ngoại lệ 4/5 ảnh; hai primitive đó
đã được hoãn sang Pha 1b (§6.5).

### 7.2 Mỗi recipe co giãn riêng

Sau khi hoán đổi, mỗi recipe thêm `layoutOverrides` để cùng một primitive ra dáng riêng. Override
chỉ được tính vào G2 khi `meaningfullyDiffers()` đạt ngưỡng: ít nhất một cạnh/vị trí đổi ≥1% canvas,
rotation đổi ≥1°, hoặc silhouette đổi giữa `rect`/`circle`/`pill`. Ví dụ trên
`circle_trio_stagger`:

```jsonc
// jmii-silk-botanical-01 — medallion đều nhau, thanh thoát
"layoutPresets": {
  "circle_silk": { "radius": 280, "border": 8, "borderColor": "#FFFFFF", "shadow": true }
},
"layoutOverrides": { "photoSlots": {
  "p2": { "y": 250, "width": 560, "height": 560, "frame": "circle_silk" }
}}

// korean-soft-01 — medallion giữa to hơn hẳn, hai bên tụt xuống
"layoutPresets": {
  "circle_soft_small": { "radius": 220, "border": 8, "borderColor": "#FFFFFF", "shadow": true },
  "circle_soft_large": { "radius": 300, "border": 8, "borderColor": "#FFFFFF", "shadow": true }
},
"layoutOverrides": { "photoSlots": {
  "p1": { "y": 180, "width": 440, "height": 440, "frame": "circle_soft_small" },
  "p2": { "x": 660, "y": 200, "width": 600, "height": 600, "frame": "circle_soft_large" },
  "p3": { "y": 180, "width": 440, "height": 440, "frame": "circle_soft_small" }
}}
```

⚠️ Khi override `width/height` của slot dùng frame tròn, **phải override cả `frame`** với radius
mới bằng nửa cạnh — nếu không, slot 600px đeo `circleMedallion` (radius 260) sẽ ra hình bo góc,
không phải hình tròn. Cách sạch: mỗi recipe khai preset tròn riêng trong `layoutPresets`
(`circle_silk: {radius: 280, ...}` cho slot 560px), vừa đúng hình vừa cộng vào bản sắc riêng.

#### Guard bắt buộc sau P1.7R

- `circle_trio_stagger`, `overlap_stack_duo` và `inset_card_hero` sở hữu frame ở photo slot.
  Look đích **không được** giữ global `frame`, và scene request cũng không được gắn frame riêng,
  vì precedence `def.frame → resolvedFrame → slot.frame` sẽ xoá frame nội tại.
- `stacked_horizon_trio` chỉ dùng cho scene mà **mọi** request có `orient: "landscape"`.
  Override chỉ nudge vị trí, giữ aspect từng dải `≤4:1`, coverage `≥50%` và thế so le
  (`band2` lệch phải rõ ràng, `band1/band3` gần cùng trục). Map active chỉ còn hai host:
  `afterparty-pulse-01/s03_dinner` và `cinematic-vows-01/s02_anticipation`.
- `offset_portrait_hero` giữ slot tối thiểu `1240×900` và coverage `≥53%`; chỉ nudge vị trí.
  Không thu ảnh về `1020×900` vì sẽ tái tạo khoảng chết mà P1.7R vừa sửa.
- `diagonal_staircase_trio` giữ từng slot tối thiểu `620×500` và coverage `≥44%`.
  Nudge phải dựa trên base `x=90/650/1210`, không dùng lại toạ độ của bản 560×460.

### 7.3 Khoá adoption plan trước khi ghi file

Tạo một adoption map machine-readable (recipe → scene/look → primitive → override) làm **nguồn
chuẩn**. `scripts/adoptNewPrimitives.mjs --check-plan` phải áp map lên bản sao in-memory, tuyệt đối
không ghi file, rồi fail nếu bất kỳ điều kiện nào sau đây sai:

1. 23 recipe tự do sáng tạo đạt ≥3 scene meaningful; `white-weddings-full-01` vẫn ≥1.
2. `reachable.maxShare ≤12`, `reachable.over12Count = 0`, và report liệt kê mọi occurrence từ
   scene chính, fallback lẫn repeat variant.
3. Photo demand của từng đường chạy không đổi; union text key trước/sau được bảo toàn.
4. Chuỗi gallery-tail của mỗi recipe vẫn duy nhất.
5. Mỗi primitive active được ≥2 recipe dùng; không có entry Pha 1b lọt vào map.
6. Guard P1.7R ở §7.2 xanh: không frame nội tại nào bị look đè, không dải ngang nào quay lại
   >4:1/host portrait, và coverage của portrait/diagonal không thụt lùi.
7. **Không đường chạy nào mất phần dressing recipe tự viết.** Look field bị bỏ chỉ hợp lệ khi có
   chính sách đặt tên (hiện chỉ có một: `frame` bị bỏ trên primitive sở hữu frame nội tại). Override
   `background` do look nguồn vẽ phải được mang sang look đích — nó là thứ duy nhất trong
   `layoutOverrides` đi được sang một layout khác, và mất nó thì không gate đếm ảnh/đếm text nào thấy.
8. **Không request nào rơi vào slot sai hướng.** Request ghi rõ `orient` mà slot đích không cùng lớp
   hình dạng là lỗi cứng. Request `orient: "any"` đổi lớp hình dạng so với slot nguồn thì phải được
   ký nhận bằng `accepts: ["orientation"]` ngay trong adoption.
9. **Không hai recipe nào dùng chung một composition.** Bar đã commit trong
   `test/template-recipes.test.mjs` là 1/3, nhưng catalogue đang đứng ở 0; audit gallery-tail so cả
   chuỗi `s83 > s84 > s85` nên một scene trùng lẻ nằm bên trong vẫn vô hình. Giữ nguyên mức 0.
10. Mục tiêu ở (1) và (2) phải được đo trên **cây mô phỏng sau adoption**, kèm lint authoring-rules
    trên chính cây đó. Đo trên cây nguồn chỉ nói lên trạng thái trước khi migrate.

Chỉ khi dry-run này xanh mới cho phép chế độ ghi. Sau khi mỗi batch được ghi, chạy lại
`--check-plan` trên trạng thái còn lại để phát hiện drift giữa map và source sớm — nghĩa là gate
phải chạy được trên cây **nửa migrate**: adoption đã ghi thì verify lại theo map (look đích đúng
primitive, đúng override, không mang thêm field lạ), không áp lần hai. Chế độ ghi chạy đúng bộ gate
của chế độ kiểm, không ít hơn.

**Phần đa dạng hoá rơi vào đâu.** 64 trong 70 adoption nằm ở đuôi gallery co giãn `s83/s84/s85`; chỉ
6 chạm story beat thật (`cinematic-film-01/s08c_breather`, `jmii-silk-botanical-01/s05_arch_gallery`,
`jmii-silk-botanical-01/s11_side_by_side`, `afterparty-pulse-01/s03_dinner`,
`cinematic-vows-01/s02_anticipation`, `four-seasons-love-01/s03_autumn`). 20 trên 23 recipe đạt sàn
"≥3 scene meaningful" hoàn toàn bằng phần đuôi. Đây là lựa chọn có chủ đích — đuôi là nơi hình học bị
dùng chung nặng nhất nên hạ `maxShare` ở đó là rẻ nhất — nhưng nó có nghĩa là **thân phim gần như
không đổi**. Muốn đổi cả thân phim thì đó là một pha riêng, không phải hệ quả tự nhiên của Pha 2.

### 7.4 Rollout 23 recipe + 1 ngoại lệ trung thành nguồn

Viết `scripts/adoptNewPrimitives.mjs` theo đúng khuôn
[scripts/diversifyRecipeLooks.mjs](scripts/diversifyRecipeLooks.mjs) (bảng map cứng recipe → look,
ghi đè JSON tại chỗ, ném lỗi nếu recipe không khớp kỳ vọng). Trước khi sửa, script phải in report
`geometry key → recipe → look/scene/fallback/repeat variant` cho **bảy** reachable key đang bị
>12 recipe dùng (23, 15, 15, 14, 14, 13, 13). Muốn hạ trần chia sẻ, phải thay **mọi occurrence**
của key mục tiêu trong đủ số recipe; thêm scene mới mà vẫn để một scene cũ/fallback/variant dùng
key đó thì con số không giảm.

Adoption map phải liệt kê chính xác ≥3 scene/look cho mỗi recipe, giữ nguyên photo demand, và mỗi
primitive mới được ≥2 recipe dùng. Danh sách scene cụ thể là dữ liệu bắt buộc của script chứ không
được chọn ngẫu hứng lúc chạy — lấy từ bảng dưới:

**Snapshot ứng viên đã quét tại ngày 2026-07-30** (chỉ để review, không phải nguồn chuẩn; script
phải sinh lại và đối chiếu trước khi ghi). Snapshot lọc theo *cùng photo demand* **và** *union
text key trên main/fallback/variants ⊆ text slot của layout đích*; bỏ scene
`durationRole: "closing"` vì builder ép nền bookend nên layout ở đó không có tác dụng.
Viết tắt: overlap=`overlap_stack_duo`, inset=`inset_card_hero`,
golden=`golden_column_pair`, circle=`circle_trio_stagger`, diagonal=`diagonal_staircase_trio`,
horizon=`stacked_horizon_trio`, portrait=`offset_portrait_hero`.

Snapshot đã được đồng bộ theo P1.7R: chỉ hai host all-landscape được liệt kê trong guard §7.2
có lựa chọn `horizon`; mọi scene 3 ảnh khác chỉ dùng `circle` hoặc `diagonal`.

| Recipe | #ứng viên | Scene có thể nhận primitive nào |
|---|---:|---|
| `afterparty-pulse-01` | 5 | s02c_cheers_duo (2ả)→overlap/golden; s03_dinner (3ả)→circle/diagonal/horizon; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `cinematic-film-01` | 4 | s08c_breather (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_feature_duo (3ả)→circle/diagonal |
| `cinematic-vows-01` | 5 | s02_anticipation (3ả)→circle/diagonal/horizon; s02b_anticipation_detail (2ả)→overlap/golden; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `city-to-ceremony-01` | 4 | s05_ready (2ả)→overlap/golden; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `classic-luxury-01` | 4 | s55_gallery_trio (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_feature_duo (3ả)→circle/diagonal |
| `classic-multisong-album-01` | 6 | s04_photo_duo (2ả)→overlap/inset/golden; s08_paper_collage (3ả)→circle/diagonal; s16_polaroid_memories (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_arch_trio (2ả)→overlap/inset/golden; s85_feature_duo (3ả)→circle/diagonal |
| `editorial-bold-01` | 3 | s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `family-roots-01` | 3 | s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `four-seasons-love-01` | 4 | s03_autumn (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `garden-botanical-01` | 3 | s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `garden-diary-01` | 5 | s02_portraits (3ả)→circle/diagonal; s55_diary_pages (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_feature_duo (3ả)→circle/diagonal |
| `heritage-ceremony-01` | 5 | s02_details (3ả)→circle/diagonal; s05b_ceremony_detail (2ả)→overlap/golden; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `jmii-silk-botanical-01` | 5 | s05_arch_gallery (3ả)→circle/diagonal; s11_side_by_side (2ả)→overlap/inset/golden; s83_gallery_matte (1ả)→portrait; s84_feature_duo (2ả)→overlap/inset/golden; s85_paper_collage (3ả)→circle/diagonal |
| `korean-soft-01` | 3 | s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `letters-to-forever-01` | 5 | s02_first (3ả)→circle/diagonal; s06_postscript (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `long-distance-love-01` | 6 | s01_places (2ả)→overlap/inset/golden; s04_miles (3ả)→circle/diagonal; s55_two_cities (2ả)→overlap/golden; s83_gallery_matte (1ả)→portrait; s84_arch_trio (2ả)→overlap/inset/golden; s85_feature_duo (3ả)→circle/diagonal |
| `luminous-editorial-motion-01` | 6 | s03_fragments (3ả)→circle/diagonal; s07_visual_breath (3ả)→circle/diagonal; s12_afterglow (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_tinted_duo (3ả)→circle/diagonal |
| `modern-teal-01` | 4 | s02b_minimal_duo (2ả)→overlap/golden; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `playful-scrapbook-01` | 4 | s01_open (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `studio-white-prewedding-01` | 3 | s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `three-chapters-biography-01` | 3 | s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `warm-film-01` | 4 | s02_candid (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `white-weddings-editorial-01` | 5 | s07_editorial_scatter (3ả)→circle/diagonal; s10_paper_story (3ả)→circle/diagonal; s83_gallery_matte (1ả)→portrait; s84_photo_duo (2ả)→overlap/inset/golden; s85_arch_trio (3ả)→circle/diagonal |
| `white-weddings-full-01` | 9 | *(không migrate — xem dưới; giữ ratchet baseline riêng)* |

**Đọc bảng này ra ba kết luận bắt buộc:**

1. **Mọi recipe tự do đều đạt ≥3 ứng viên** — nhưng chỉ nhờ có `offset_portrait_hero`. Không có
   primitive 1 ảnh đó, 6 recipe (`editorial-bold-01`, `family-roots-01`, `garden-botanical-01`,
   `korean-soft-01`, `studio-white-prewedding-01`, `three-chapters-biography-01`) chỉ có **2**
   ứng viên và không thể đạt ratchet ≥3 bằng hoán đổi, phải bù bằng `layoutOverrides`.
2. **`offset_quad_pinwheel` (4 ảnh) có đúng MỘT host trong toàn bộ catalogue**, và đó là
   `white-weddings-full-01/s19b_grid_recap` — chính recipe đã cam kết bám nguồn nên không migrate.
3. **`filmstrip_band` (5 ảnh) có KHÔNG host nào.** Không recipe nào có scene 5 ảnh, và Premium
   không tự phát 5 ảnh (§6.3).

**Quyết định đã chốt:** `offset_quad_pinwheel` + `filmstrip_band` ở Pha 1b (§6.5), không merge
trong Pha 1 và không xuất hiện trong adoption map Pha 2.

Bảy primitive còn lại (`overlap`, `inset`, `golden`, `circle`, `diagonal`, `horizon`, `portrait`)
gánh toàn bộ mục tiêu của Pha 2. Sáu primitive đầu/cuối có host rộng; riêng `horizon` cố ý chỉ có
hai host all-landscape để không đổi diversity lấy crop khuôn mặt.

`white-weddings-full-01` — 25 scene bám sát nguồn Canva — **không nhận primitive mới**. Recipe
này giữ ratchet riêng `≥1` scene lệch gốc (baseline hiện có), vì thêm ba hình học mới sẽ phá lời
hứa trong `source.notes`.

Sáu recipe chỉ có 3 ứng viên (`editorial-bold-01`, `family-roots-01`, `garden-botanical-01`,
`korean-soft-01`, `studio-white-prewedding-01`, `three-chapters-biography-01`) phải dùng **cả ba**
— và cả ba đều nằm ở đuôi `s83/s84/s85`, nên bộ ba của chúng dễ đụng nhau nhất trong test
gallery-tail. Phải mô phỏng **cả sáu cùng lúc** trong `--check-plan` để thấy xung đột toàn cục;
khi ghi file vẫn chia 3–4 recipe/commit để rollback gọn.

Rollout theo batch nhỏ, ví dụ 3–4 recipe/commit. Cuối mỗi batch:

1. Nâng map per-recipe của đúng các recipe vừa migrate lên 3.
2. Đo lại trần chia sẻ rồi chỉ hạ threshold tới con số vừa chứng minh được.
3. Chạy lint/test trước khi sang batch tiếp; không đặt trước một threshold mà batch chưa đạt.

### 7.5 Nghiệm thu Pha 2

- [ ] `node scripts/adoptNewPrimitives.mjs --check-plan` → xanh, không ghi file
- [ ] `node scripts/lintStoryTemplates.mjs` → 24 clean
- [ ] Targeted geometry/layout/template tests, cross-recipe ≤1/3 và gallery-tail → tất cả pass
- [ ] 23 recipe tự do sáng tạo đạt ≥3 scene meaningful; `white-weddings-full-01` vẫn ≥1
- [ ] Không arrangement V2 reachable nào có mặt trong >12 recipe; report occurrence chứng minh
      bảy nhóm 23/15/15/14/14/13/13 đã được hạ đủ, không chỉ bị pha loãng bằng key mới
- [ ] `npm run preview:tier1` trên ≥2 job thật — shot list phải giải được, không tụt về Lite
- [ ] Không scene/fallback/repeat variant nào mất chữ hoặc đổi photo demand; `--check-plan` đối chiếu
      union trước/sau và test có fixture riêng cho các nhánh không-main

---

## 8. Pha 3 — Bán kính theo từng góc, mở khoá arch thật (~4–6h, tuỳ chọn)

Chỉ làm nếu Pha 1-2 đã ổn định. Đây là thay đổi engine duy nhất trong kế hoạch.

### 8.1 Điểm chạm

1. [src/types.ts:281-286](src/types.ts#L281-L286) — `LayerFrame.radius?: number | [number, number, number, number]`
   (tl, tr, br, bl). Giữ `number` = cả 4 góc, nên mọi recipe cũ không đổi hành vi.
2. [src/validateTimeline.ts:114](src/validateTimeline.ts#L114) — zod union: `z.number().min(0).max(400)`
   hoặc `z.tuple([...])`. Cân nhắc nâng cap 400 → 540 để slot 1080px cao vẫn tròn được đầu.
   Validator primitive/resolved look phải kiểm thêm từng radius ≤ nửa cạnh ngắn và tổng hai
   radius kề nhau không vượt chiều rộng/chiều cao tương ứng.
3. [src/buildLayerSceneCommand.ts:156-164](src/buildLayerSceneCommand.ts#L156-L164) —
   `roundedMaskGeq()` hiện tính `dx = max(max(r-X, X-(W-1-r)), 0)` cho cả 4 góc bằng một `r`.
   Sửa thành biểu thức chọn `r` theo góc phần tư:
   ```
   rx = X < W/2 ? (Y < H/2 ? tl : bl) : (Y < H/2 ? tr : br)
   ```
   viết bằng `if(lt(X,W/2), ...)` của ffmpeg `geq`. Nhánh có `r=0` phải trả nguyên alpha, không
   được đưa `0` vào công thức cũ — nếu không cả quadrant nhận alpha 0.5. **Rủi ro**: biểu thức
   `geq` dài làm chậm render đáng kể; đo thời gian một scene trước/sau, nếu >20% chậm hơn thì
   đổi hướng sang sinh mask PNG một lần rồi `alphamerge`.
4. [layouts/library.json](layouts/library.json) — thêm preset `arch: { radius: [260, 260, 0, 0] }`
   và một primitive `arch_window_trio` dùng nó (arch thật, thay cho `arch_trio` đang là 3 chữ nhật).
5. Test mới trong `src/buildLayerSceneCommand.test.ts`: dạng số cho ra chuỗi filter **giống hệt
   hôm nay** (chống hồi quy); dạng mảng phủ `[260,260,0,0]`, bốn radius khác nhau, border và
   radius 0. Ngoài test chuỗi, render một mask nhỏ rồi kiểm alpha pixel ở bốn góc và giữa cạnh.
   Thêm file này vào lệnh `test:api` hoặc gọi tường minh bằng `node --import tsx --test`; tạo test
   mà không nối vào test runner không được tính là nghiệm thu.

### 8.2 Vì sao đáng làm

Arch/cửa vòm là ngôn ngữ thị giác trung tâm của cưới 2026, và hiện engine không làm được ở bất
kỳ đâu — kể cả layout đã tự nhận tên `arch_trio`. Đây là khả năng mà cả 7 primitive active ở
Pha 1 **không** mua được.

---

## 9. Quy trình kiểm chứng

### 9.1 Bộ lệnh chuẩn sau mỗi pha

```powershell
node scripts/validateLayoutPrimitive.mjs layouts/library.json
node scripts/lintStoryTemplates.mjs
node --test --test-timeout=30000 test/layout-geometry.test.mjs test/library.test.mjs test/template-recipes.test.mjs
npm run typecheck        # Pha 0 thêm script; Pha 3 đổi core types/renderer
npm run test:api         # bắt buộc ở Pha 3 cho buildLayerSceneCommand.test.ts
npm run check            # cửa merge cuối trên branch/worktree sạch
```

⚠️ **Baseline `test:unit` đo lại ngày 2026-07-30 trên cây hiện tại: 326 pass / 13 fail / 339 test**
(số cũ "276/290" trong bản trước đã lỗi thời). Đây là **chẩn đoán của cây làm việc bẩn tại thời
điểm đo**, không phải tiêu chí merge và không hợp thức hoá thêm failure. 13 fail nằm ở bốn nhóm:

| Nhóm | Ví dụ test fail |
|---|---|
| music/playlist | "loop mode extends a short track's target…", "playlist mode appends the second track…" |
| extended film | "every slide in an extended film stays inside the engine's duration limits" |
| native creative effects | "tilt_shift normalizes defaults…", "the native creative effects compile to their intended FFmpeg filters" |
| vision cache | "identity is the file's bytes, not its name", "--dry-run costs what it says" |

Trước khi triển khai phải tạo branch/worktree sạch từ baseline dự định merge và chạy
`npm run check`. Targeted tests ở trên phải xanh trong từng batch; **cửa merge cuối là
`npm run check` xanh**, không phải “13 fail không tăng”. Nếu clean baseline vẫn đỏ vì lỗi ngoài
phạm vi, tách hoặc sửa baseline đó trước, rồi mới bắt đầu Pha 0.

### 9.2 So sánh premium trước/sau (bắt buộc ở Pha 1)

```powershell
# Cuối Pha 0, trước khi sửa library:
npm run premium -- --project <job> --dry-run > temp/premium-before.txt

# Sau Pha 1, trên cùng input và config:
npm run premium -- --project <job> --dry-run > temp/premium-after.txt
```

Không dùng `git stash`: nó lấy toàn bộ thay đổi tracked của cây làm việc và dễ xung đột với phiên
song song. Đối chiếu số scene, phân bố ảnh/scene và danh sách layout. Kỳ vọng: shape phim giữ
nguyên, rotor 1/2/3 ảnh đa dạng hơn. Cảnh báo đỏ: xuất hiện card 4/5 ảnh, số scene đổi, hoặc ảnh
không còn được đặt hết — đó là hồi quy ngoài phạm vi Pha 1.

### 9.3 Probe hình ảnh (bắt buộc ở Pha 1, bước 1.6)

Dựng một timeline probe trong `temp/` với đúng 7 scene — mỗi scene một primitive active, cùng một
bộ ảnh — rồi:

```powershell
Remove-Item -Recurse -Force temp/scene-cache   # BẮT BUỘC, xem §10
npm run render -- temp/probe-primitives.json
```

⚠️ `temp/scene-cache/` **không tự invalidate khi code renderer hoặc library đổi**. Không xoá =
bạn đang nghiệm thu frame cũ và sẽ kết luận sai. Đây là cái bẫy đã cắn ít nhất một lần trước đây.

---

## 10. Sổ rủi ro

| # | Rủi ro | Xác suất | Hậu quả | Giảm thiểu |
|---|---|---|---|---|
| R1 | Rotor 1/2/3 ảnh đổi lựa chọn Premium ngoài dự kiến | trung bình | nhịp card không đổi nhưng layout xấu hơn | §9.2 dry-run cùng input; card 4/5 ảnh là lỗi |
| R2 | `look.frame` của recipe đè frame nội tại | **cao** | circle mất medallion; overlap/inset mất viền thẻ, im lặng | §3.6 và §7.2; look đích không giữ global frame trên ba primitive này |
| R3 | Nghiệm thu nhầm trên `temp/scene-cache` cũ | **cao** | kết luận sai về cả pha | §9.3, xoá cache trước mọi lần render kiểm |
| R4 | Primitive có vùng dành cho chữ bị gắn vào scene không chữ | trung bình | khung hình trông thiếu nội dung dù gate kỹ thuật xanh | primitive active ưu tiên host-semantic; probe cả trường hợp có/không copy, không dùng nếu khoảng trống mất cân bằng |
| R5 | Phiên Claude song song ghi đè cùng file | **cao** (đã xảy ra nhiều lần) | mất việc | commit theo pha, `git status` trước mỗi pha, không để cây bẩn qua đêm |
| R6 | Override `width` mà quên override `radius` | cao | tròn thành bo góc | §7.2; cân nhắc thêm cảnh báo vào validator: slot có frame tròn mà `radius ≠ min(w,h)/2` |
| R7 | Biểu thức `geq` 4 góc sai ở radius 0 hoặc làm chậm render | trung bình | nửa dưới arch mờ / Pha 3 chậm | test alpha pixel + benchmark; dự phòng alphamerge |
| R8 | Ratchet siết quá nhanh làm CI đỏ triền miên | thấp | mất niềm tin vào test | ngưỡng khởi đầu = hiện trạng, chỉ siết ở **cuối** mỗi pha |
| R9 | 1px nudge tạo key mới nhưng mắt không thấy khác | cao nếu dùng JSON exact | metric lại bị lách | lượng tử hoá 1% canvas + `meaningfullyDiffers()` |
| R10 | Chỉ thêm key mới nhưng vẫn giữ key chung 23× | cao | diversity tăng trên giấy, trần chia sẻ không giảm | report mọi occurrence và thay hết key mục tiêu trong đủ recipe |
| R11 | Metric bỏ text slot → mọi thiệp kết thành một key rỗng | **đã xảy ra ở bản đầu** | mục tiêu bất khả thi về toán học, phát hiện muộn | dùng key V2 (§1) + test chống hồi quy 0.2.4 |
| R12 | Hoán đổi layout làm rơi chữ trong im lặng | **cao** | recipe mất một dòng copy, lint/test vẫn xanh | luật hai vế ở §7.1; `--check-plan` §7.3 đối chiếu main/fallback/variants |
| R13 | Merge primitive không có host (pinwheel/filmstrip) | trung bình | từ vựng chết, tưởng đã đạt mục tiêu | đã chốt tách Pha 1b (§6.5); active adoption map phải từ chối hai id này |

---

## 11. Rollback

Pha 0/1/3 là các commit độc lập; Pha 2 là chuỗi batch nhỏ, mỗi batch revert được riêng:

- **Pha 0** — revert được độc lập. Lưu ý siết V4/G7 là thay đổi validation thật: cây hiện tại
  sạch theo luật mới, nhưng look tương lai từng dựa vào bleed sẽ bị từ chối.
- **Pha 1** — revert an toàn *nếu chưa có recipe nào gọi tên primitive mới*. Nếu Pha 2 đã merge,
  phải revert Pha 2 trước (nếu không `recipe-engine-contract.test.mjs` sẽ đỏ vì recipe trỏ vào
  layout không còn tồn tại).
- **Pha 2** — revert theo từng recipe (mỗi file JSON độc lập).
- **Pha 3** — revert engine; các preset dạng mảng còn sót lại sẽ bị zod từ chối → phải revert
  cả preset trong library cùng lúc. Ghi rõ điều này trong commit message.

---

## 12. Ước lượng & thứ tự

| Pha | Nội dung | Ước lượng | Chặn bởi |
|---|---|---|---|
| 0 | Metric lượng tử hoá + silhouette + V4/G7 + validator | ~2–3h | — |
| 1 | 7 primitive active + 1 frame preset + probe + dry-run | ~3–4h | Pha 0 |
| 2 | Pilot 3 recipe → rollout 23 recipe theo batch (7 primitive có host) | ~6–10h | Pha 1 |
| 3 | Bán kính 4 góc, test mask thật, benchmark arch | ~4–6h | Pha 1 (độc lập với 2) |

Pha 1b (pinwheel/filmstrip) không nằm trong tổng dưới đây; chỉ ước lượng khi có host/allocator
cụ thể và adoption plan riêng.

**Tổng Pha 0-2: ~11–17h**, chưa tính PR telemetry server/web tùy chọn. Khuyến nghị làm Pha 0 +
Pha 1 trong một phiên, dừng lại xem probe render bằng mắt, rồi rollout Pha 2 thành nhiều commit
nhỏ thay vì sửa 23 JSON trong một lần.

---

## 13. Tiêu chí nghiệm thu cuối

- [ ] `catalogDistinct` V2: 49 → **≥56** sau Pha 1; `authoredDistinct` giữ sàn 48 rồi ratchet
      theo adoption plan đã mô phỏng
- [ ] Reachable arrangement V2 bị >12 recipe dùng chung: 7 → **0**; `maxShare ≤12`
- [ ] Test chống hồi quy metric: `closing_names` giữ **11 key**, nhóm lớn nhất **≤9**
- [ ] 23 recipe tự do sáng tạo có ≥3 scene meaningful khác layout gốc
- [ ] `white-weddings-full-01` giữ ≥1 scene lệch gốc và không nhận primitive phá cam kết nguồn
- [ ] `node scripts/lintStoryTemplates.mjs` → 24/24 clean
- [ ] Targeted geometry/layout/template tests xanh ở mỗi batch; `npm run check` xanh trên
      branch/worktree sạch trước merge
- [ ] Dry-run Premium: cùng số scene/phân bố ảnh; rotor 1/2/3 đa dạng hơn; không xuất hiện card 4/5
- [ ] Probe render 7 primitive active: xem bằng mắt, không có ảnh bị cắt mặt, không chữ đè ảnh,
      medallion tròn thật sự tròn
- [ ] `adoptNewPrimitives --check-plan` chứng minh không main/fallback/repeat variant nào mất copy
      hoặc đổi photo demand, mỗi primitive active có ≥2 host và gallery-tail vẫn duy nhất
- [ ] Docs: không file `.md` nào ghi cứng tổng số layout (đã kiểm), nên việc duy nhất là bổ sung
      mô tả 7 primitive active vào phần "Assign a layout" của [docs/generation-guide.md](docs/generation-guide.md#L104-L122)
      và luật hình học mới (nếu có) vào [docs/TEMPLATE-RULES.md](docs/TEMPLATE-RULES.md);
      sau đó `npm run docs:check` phải xanh — nó từ chối mọi tên file `.mjs`/`.ts` và mọi link
      nội bộ không tồn tại trong `docs/`

---

## Phụ lục A — Vì sao *không* chọn các hướng khác

| Hướng | Vì sao loại |
|---|---|
| Sinh layout ngẫu nhiên theo thuật toán lúc runtime | Mất tính tất định — cả pipeline (photo budget, solver, cache, regression frame) dựa trên việc hình học là dữ liệu tĩnh, biết trước |
| Để AI director tự chế toạ độ | Chính xác là thứ layout library được lập ra để chấm dứt (xem `meta.purpose`); AI không thấy hình ảnh nó đang bố cục |
| Chỉ thêm `layoutOverrides` cho 23 recipe, không thêm primitive | Không mở được cấu trúc mới về **số slot** và **panel**; Premium không đọc look của recipe nên rotor 1/2/3 ảnh vẫn chỉ thấy library cũ |
| Sửa `geometryOf()` để bỏ frame/treatment khỏi `resolvedSignature` | Làm 247 look hiện có đổi chữ ký cùng lúc → cache, metric, test, regression frame lệch hết trong một cú. Pha 0 thêm thước đo song song thay vì đổi thước cũ |

## Phụ lục B — Bảng tra nhanh khi tự thiết kế primitive

```
canvas 1920×1080 = 2,073,600 px²
sàn 1 slot (<6 slot):  8% = 165,888 px²   → ví dụ 460×370 vừa đủ
sàn 1 slot (≥6 slot):  5% = 103,680 px²   → ví dụ 340×310
sàn coverage scene:   35% = 725,760 px²   (25% nếu textRequired; bỏ qua nếu full-bleed bg)
safe margin: 70px → text nằm trong 70..1850 × 70..1010
tròn hoàn hảo: slot vuông cạnh ≤800, radius = cạnh/2
meaningful delta: vị trí/kích thước ≥1% canvas, rotation ≥1°, hoặc đổi rect/circle/pill
lượng tử hoá metric: 1% ngang = 19.2px, 1% dọc = 10.8px, rotation 1°
xoay θ: rotw = |w·cosθ| + |h·sinθ|, roth = |w·sinθ| + |h·cosθ| (phải còn trong canvas)
type scale: heading ≥68px / body ≥32px CHỈ được test trên long-distance-love-01 — dùng làm
            hướng dẫn thiết kế, không phải cửa (12/25 layout hiện tại vi phạm, suite vẫn xanh)
hoán đổi layout an toàn: cùng số photo slot VÀ text key của scene ⊆ text slot id của layout mới
```

## Phụ lục C — Nhật ký kiểm chứng (2026-07-30)

Mọi con số trong tài liệu này đến từ các phép đo dưới đây, chạy trên cây làm việc thật. Nếu sửa
kế hoạch, đo lại chứ đừng chép số cũ.

| Điều được kiểm | Cách đo | Kết quả |
|---|---|---|
| Phân bố `authored` V1/V2 | 233 scene chính qua `resolveTemplate` + key lượng tử hoá | V1: 30 key, 8 key >12. V2: 48 key, 6 key >12 |
| Phân bố V2 theo scope | union library/authored và main/fallback/repeat variants | `catalogDistinct=49`; `reachable`: 7 key >12, maxShare=23 |
| Artefact thiệp kết | so nhóm `closing_names` lớn nhất giữa V1 và V2 | 24 → **9** — V1 mù với hình học chữ |
| Ratchet riêng `closing_names` | đếm key V2 và group size trên 24 recipe | **11 key**, nhóm lớn nhất **9** |
| Premium có tự chọn card 4/5 ảnh không | đọc `allocatePhotos` (`sizes = [3, 2]`) + `pickLayoutSize` (`Math.min(want, 4)` đi xuống) | **không**; bucket 4 đã chết sẵn từ trước |
| G5 có phải luật toàn cục | đọc test + đếm slot vi phạm | **không** — chỉ 1 recipe; 74/226 slot và 12/25 layout đang "vi phạm" mà suite vẫn xanh |
| Validator trên library hiện tại | `validateLayoutPrimitive` với G5 = error | 12 pass / 13 fail, **toàn bộ fail là G5** → G5 phải là warning |
| Draft 9 primitive ban đầu | validator G1-G8 trước khi chốt plan | **9/9 pass**, nhưng pinwheel/filmstrip không có host; không dùng kết quả này để nghiệm thu 7 entry active đã chỉnh |
| 7 primitive active | phép đếm catalog mô phỏng | `catalogDistinct` **49 → 56**; phải chạy lại G1-G8 và probe sau khi dán JSON thật |
| Host cho từng primitive | quét demand + text key trên 24 recipe | 7 primitive có host khắp nơi; `pinwheel` **1 host duy nhất** (recipe không migrate); `filmstrip` **0 host** |
| Baseline test trên cây làm việc lúc đo | `npm run test:unit` đầy đủ | **326 pass / 13 fail / 339**; chỉ là chẩn đoán, cửa merge là `npm run check` xanh trên branch sạch |
| Slot vượt canvas trong recipe | quét resolved geometry | **0** — licence 50% của V4 chưa từng được dùng |
| `--project` / `--dry-run` | đọc `runProject.mjs:32,34` | cả hai cờ tồn tại |
| `tsconfig.scripts.json` | đọc `include` | danh sách file tường minh — file mới phải thêm tay |
| `src/buildLayerSceneCommand.test.ts` | `ls` + đọc `test:api` | **chưa tồn tại**; `test:api` liệt kê file cứng, không glob |
| Docs có ghi cứng số layout không | grep `docs/*.md` | **không** — chỉ `generation-guide.md` và `TEMPLATE-RULES.md` nhắc tên layout |
