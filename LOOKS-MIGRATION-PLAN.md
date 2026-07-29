# Kế hoạch triển khai: Recipe Looks (hybrid layout/look)

Ngày lập: 2026-07-29. Nhánh: `agent/refactor-engine-and-add-momo`.

## Trạng thái (cập nhật 2026-07-29)

| Phase | Trạng thái | Commit |
| --- | --- | --- |
| 0–1 resolver + V1–V7 | ✅ xong | `1fce756` |
| 2 nối vào pipeline (byte-identical) | ✅ xong | `0f924a9` |
| 3 lint trên hình học đã resolve | ✅ xong | `b35f76c` |
| 4 metric signature/layout/effect | ✅ xong | `803ad96` |
| 5 treatment + stagger | ✅ xong | `1c32def`, `59073cd` |
| 6 migrate recipe | 🔶 **3/24** (jmii, white-weddings-full, cinematic-film) | `5b1186b`, `33437f5`, `ca74231` |
| 7 premium / scene composed | ⬜ chưa quyết | — |
| 8 tài liệu | ✅ xong (TEMPLATE-RULES.md) | `5f6248e` |

**Khác với plan gốc, và vì sao:**

- **§5.2 đảo ngược.** `photoTreatment` KHÔNG nằm trong `technicalColor`. Render thật cho
  thấy schema chặn `saturation` ngoài `0.9..1.1` — đúng, vì đó là biên của bộ chuẩn hoá
  ảnh tự động. Look là chỉ đạo nghệ thuật, nên có field riêng `ImageSceneLayer.grade`
  (saturation/contrast/brightness). `contrast` vì thế được làm luôn — điều kiện "chỉ làm
  khi có recipe thật cần" đã thoả.
- **V4 nới cho ảnh.** Bleed ảnh khỏi mép khung là bố cục thật (library tự làm, ghi trong
  `meta.coordinateNote`). Rule đổi thành "quá nửa slot ra ngoài canvas mới là lỗi"; chữ
  vẫn giữ safe margin nghiêm ngặt.
- **`layouts/library.json` chưa sửa.** Câu ghi chú "library chỉ giữ primitive" thuộc về
  file đó, nhưng file đang mang ~1000 dòng chưa commit của phiên làm việc song song.

**Còn lại:** 21 recipe chưa migrate, và quyết định Phase 7.

**Đã tìm thấy, chưa sửa (ngoài phạm vi):** layout `three_photo_row` trong library tự nó
có va chạm — slot ảnh `right` (1262,434 551×551) đè lên 24% text slot `caption`
(96,880 1728×140). Nhìn thấy trên frame render của `s07_fall_in_love`: dòng caption bị
ảnh che mất đuôi. Sửa nó đổi hình học cho MỌI recipe dùng layout này, nên cần quyết
định riêng.

---

## 0. Mục tiêu và ranh giới

**Mục tiêu.** Cho phép mỗi recipe sở hữu nhận diện thị giác riêng (`looks`) trong khi
`layouts/library.json` tiếp tục sở hữu hình học an toàn dùng chung, mà không phá vỡ
solver ảnh, không làm mù bộ lint, và không làm hỏng metric đa dạng.

**Chuỗi fallback đích:**

```
scene.look → recipe.looks[look] → shared layout (library) → recipe.defaults → library designTokens
```

**Phân chia trách nhiệm đích:**

| Tầng | Sở hữu | File |
| --- | --- | --- |
| Layout library | Tọa độ mặc định, slot, safe area, sàn coverage | `layouts/library.json` |
| Recipe defaults | Palette, typography, color grade, overlays toàn film | `story-templates/*.json` → `defaults`, `libraryTheme` |
| Recipe looks | Layout ref + override hình học + frame + treatment + motion | `story-templates/*.json` → `looks` (MỚI) |
| Scene | Chọn look, cấp ảnh/copy, thời lượng, story role | `story-templates/*.json` → `scenes[]` |
| Effect code | 3D, mask động, particle, shader | `gpu-effects/`, `blender/`, `src/build*.ts` |

### 0.1 Bất biến — vi phạm bất kỳ điều nào dưới đây là bug chặn merge

- **I1. Số photo slot không đổi.** `layoutOverrides` chỉ được sửa slot đã tồn tại; không
  thêm, không xóa, không đổi `id`. Lý do: `photoDemand()` tại
  `scripts/lib/engineCapabilities.mjs:196-208` tính ngân sách ảnh bằng
  `layout.photoSlots.length` đọc thẳng từ library. Đây là hàm duy nhất biết câu trả lời
  ("so the shot list, the budget and the assignment cannot disagree"). Giữ I1 thì
  `photoDemand` không cần biết looks tồn tại.
- **I2. Resolver thuần và idempotent.** `resolve(resolve(x)) === resolve(x)`. Phải gọi được
  nhiều lần trên cùng một scene, vì `recipeShotList` hoán đổi layout giữa chừng.
- **I3. Một resolver duy nhất.** Lint, shot list, renderer, metric đều gọi cùng một hàm.
  Không có nhánh thứ hai tự merge lại.
- **I4. Không look ⇒ no-op tuyệt đối.** Recipe chưa migrate phải cho ra timeline
  **byte-identical** so với trước.
- **I5. `scene.layout` không bị bỏ.** Nó là ngôn ngữ chung của 24 recipe, của scene
  `origin:"composed"` do director sinh, và của `server/services/recipes.ts`. Look chỉ là
  lớp phủ lên nó, vĩnh viễn, không đánh dấu legacy.

### 0.2 Những thứ KHÔNG làm trong đợt này

- Không thêm `transition.in/out` vào look (xem §5.3 — lý do).
- Không thêm vignette per-layer (xem §5.2).
- Không sửa `layouts/library.json` để thêm look. Library chỉ giữ primitive.
- Không migrate nhiều hơn 1 recipe mỗi commit.

---

## 1. Baseline đo được (chạy lúc lập plan)

```
node scripts/lintStoryTemplates.mjs   →  24 template(s): 24 clean, 0 failing
story-templates/*.json                →  24 recipe, 471 scene
scene có muteFallback                 →  33
recipe có layoutPresets               →  1  (jmii-silk-botanical-01, đúng 1 preset "arch")
```

**Cảnh báo về gate `test:unit`:** trên cây sạch, `npm run test:unit` KHÔNG xanh 100% —
các fail còn lại đến từ fixture `input/` thiếu và từ phiên làm việc song song đang sửa
`src/`. Gate của mọi phase dưới đây là **"so với baseline đã ghi"**, không phải "0 fail".
Bắt buộc ghi baseline vào `temp/looks-baseline.txt` trước khi sửa dòng đầu tiên.

---

## Phase 0 — Baseline + resolver rỗng (không đụng recipe)

Mục đích: có một no-op chứng minh được, trước khi thay đổi bất kỳ hành vi nào.

### 0.A Ghi baseline

```bash
node scripts/lintStoryTemplates.mjs             > temp/looks-baseline.txt 2>&1
npm run test:unit                              >> temp/looks-baseline.txt 2>&1
npm run typecheck                              >> temp/looks-baseline.txt 2>&1
node scripts/runProject.mjs --tier template --dry-run --project <project-thật> \
                                               > temp/looks-baseline-timeline.json 2>&1
```

Lưu luôn file timeline sinh ra để so sánh byte-identical ở Phase 2.

### 0.B Tạo `scripts/lib/lookResolver.mjs`

API công khai (chốt trước khi code, mọi phase sau phụ thuộc vào nó):

```js
/** Phân giải look của MỘT scene thành hình học + treatment cụ thể.
 *  Thuần, idempotent (I2). Scene không có `look` đi qua không đổi (I4). */
export function resolveScene(scene, { template, library }) → ResolvedScene

/** Phân giải cả recipe. Dùng bởi lint và bởi applyStoryTemplate ở bước 0. */
export function resolveTemplate(template, { library }) → { scenes: ResolvedScene[], errors: [] }

/** Fingerprint thị giác — nguồn duy nhất cho mọi metric đa dạng (§4). */
export function visualSignature(resolvedScene) → string

/** Kiểm tra override hợp lệ. Trả findings, KHÔNG throw. */
export function validateLook(lookId, look, { template, library }) → finding[]
```

`ResolvedScene` = scene gốc + các field bổ sung:

```js
{
  ...scene,                  // giữ nguyên id, effect, layout, text, durationRole, ...
  layout: "three_photo_row", // KHÔNG đổi — I5, và photoDemand vẫn đọc được
  look: "ceremony_triptych", // undefined nếu scene không dùng look
  resolvedLayout: { ...layout đã merge override, photoSlots đã merge },
  resolvedFrame: {...} | undefined,
  resolvedTreatment: {...} | undefined,
  resolvedMotion: { preset, stagger } | undefined,
}
```

Quy tắc: **không mutate** `library.layouts[i]` — deep-clone layout trước khi merge. Library
là singleton dùng lại cho mọi scene trong tiến trình; mutate nó là lỗi rò rỉ giữa các scene.

### 0.C Test no-op

`test/look-resolver.test.mjs`:

- Với cả 24 recipe: `resolveTemplate` trả về scenes mà `resolvedLayout` deep-equal layout
  library tương ứng, và mọi field khác không đổi.
- Idempotent: `resolveScene(resolveScene(s))` deep-equal `resolveScene(s)`.
- Không mutate: sau khi resolve toàn bộ 24 recipe, `layouts/library.json` đọc lại vẫn
  deep-equal bản gốc.

### Gate Phase 0

- `node scripts/lintStoryTemplates.mjs` → vẫn 24 clean.
- `npm run test:unit` → baseline + số test mới, không có regression mới.
- Không file nào ngoài `scripts/lib/lookResolver.mjs` và `test/look-resolver.test.mjs` bị sửa.

---

## Phase 1 — Ngữ nghĩa: schema look, thứ tự merge, validation

Vẫn chưa recipe nào dùng look. Chỉ định nghĩa và test bằng fixture.

### 1.A Schema `template.looks`

```jsonc
{
  "looks": {
    "ceremony_triptych": {
      "layout": "three_photo_row",          // BẮT BUỘC, phải tồn tại trong library
      "layoutOverrides": {
        "photoSlots": {                      // key = slot id ĐÃ TỒN TẠI (I1)
          "left":   { "y": 220, "height": 700 },
          "centre": { "y": 120, "height": 840 }
        },
        "textSlots":  { "heading": { "sizePx": 72 } },
        "background": { "type": "cream" }    // được phép; không được đổi photo_full_bleed slot id
      },
      "frame": { "border": 3, "borderColor": "#C5A363", "radius": 0 },
      "photoTreatment": { "saturation": 0.88 },   // xem §5.2 — chỉ field engine đỡ được
      "motion": { "preset": "slow_rise", "stagger": 0.18 }
      // KHÔNG có "transition" — xem §5.3
    }
  }
}
```

Field được phép override trên `photoSlots.*`: `x, y, width, height, fit, rotation,
suggestedAnimation, frame`. Field bị cấm: `id`. Thêm slot mới: cấm.
Field được phép trên `textSlots.*`: `x, y, width, height, align, sizePx, lineSpacing,
fontRole, color`.

### 1.B Thứ tự merge (chốt cứng, viết vào comment đầu file resolver)

```
1. library.layouts[look.layout]                       (deep clone)
2. + look.layoutOverrides                             (merge nông theo slot id)
3. + scene.photoSlots[i] / scene.text                 (scene vẫn thắng — cấp nội dung)
4. frame:      scene.photoSlots[i].frame → look.frame → slot.frame → template.layoutPresets → designTokens.framePreset
5. font/color: template.defaults → libraryTheme       (giữ nguyên templateTheme.mjs:7-29)
```

Bước 4 phải đi qua `resolveFrame()` sẵn có tại `scripts/lib/templateTheme.mjs:48-54` —
hàm đó đã nhận cả tên preset lẫn object inline. `look.frame` là `layoutPresets` inline,
không phải cơ chế mới.

### 1.C Validation (`validateLook`)

| Mã | Kiểm tra | Mức |
| --- | --- | --- |
| `V1 unknown_layout` | `look.layout` không có trong library | error |
| `V2 unknown_slot` | `layoutOverrides.photoSlots` chứa id không có trong layout (I1) | error |
| `V3 slot_count_drift` | số slot sau merge ≠ trước merge (I1) | error |
| `V4 out_of_canvas` | slot sau override vượt 1920×1080 hoặc vào safeMargin=70 | error |
| `V5 text_occlusion` | photo slot sau override phủ >20% diện tích một `textSlot` mà scene có cấp copy | error |
| `V6 unused_look` | look khai báo nhưng không scene nào dùng | warning |
| `V7 look_is_noise` | 2 look có `visualSignature` giống hệt nhau (chỉ khác tên) | warning |

`V5` là rule mà bạn nêu ("không cho ảnh che vùng chữ bắt buộc") — nó chỉ tính được sau
khi resolve, đó chính là lý do validation phải chuyển sang scene đã resolve ở Phase 3.

### 1.D Test

`test/look-resolver.test.mjs` mở rộng bằng fixture in-line (KHÔNG đụng 24 recipe thật):
mỗi mã V1–V7 một test dương và một test âm. Cộng test merge order: scene thắng look,
look thắng layout, frame đi đúng 5 nấc.

### Gate Phase 1

- Test mới xanh. Lint vẫn 24 clean. Không recipe nào đổi.

---

## Phase 2 — Nối resolver vào pipeline (vẫn chưa recipe nào dùng look)

Đây là phase rủi ro nhất: đổi đường đi của dữ liệu mà không đổi kết quả.
Bằng chứng đạt yêu cầu = **timeline byte-identical với `temp/looks-baseline-timeline.json`**.

### 2.A Thứ tự pipeline hiện tại (đã xác minh trong `scripts/applyStoryTemplate.mjs`)

```
582  planTemplateShotList({ template, photos, library, ... })   ← đọc scene.layout, CÓ THỂ GHI ĐÈ nó
598  applyStoryArc(shotList.scenes, template.storyArc)   → expandedScenes
604  buildPhotoAssignmentRequests({ scenes: expandedScenes, library, direction })
623  assignPhotos(...)
633  buildDiversityReport({ scenes: expandedScenes, ... })
638  expandedScenes.map(... buildScene(scene) ...)       → layerSceneBuilder
661  retimeSlidesToMusic
```

Bốn trong sáu điểm đọc `scene.layout` chạy **trước** renderer. Vì vậy điểm chèn resolver
là **ngay sau khi load template, TRƯỚC dòng ~582**, không phải trước bước render.

### 2.B Sáu điểm đọc `scene.layout` và cách xử lý từng điểm

| # | Vị trí | Xử lý |
| --- | --- | --- |
| 1 | `scripts/lib/engineCapabilities.mjs:201` (`photoDemand`) | **Không đổi.** I1 bảo đảm số slot không đổi. Thêm comment giải thích vì sao nó an toàn. |
| 2 | `scripts/lib/scenePhotoCount.mjs:11` | **Không đổi**, cùng lý do. |
| 3 | `scripts/lib/templatePhotoRequests.mjs:17` | Ưu tiên `scene.resolvedLayout` nếu có, fallback library lookup. Chỉ ảnh hưởng `orient`/`quality` nếu look override `fit`. |
| 4 | `scripts/lib/recipeShotList.mjs:317-318` | **Sửa thật** — xem 2.C. |
| 5 | `scripts/lib/diversityPlanner.mjs:7` | Đổi sang `visualSignature(scene)` — xem §4. |
| 6 | `scripts/lib/layerSceneBuilder.mjs:27-28` | Dùng `scene.resolvedLayout`; giữ `throw` cũ làm fallback khi resolver không chạy. |

### 2.C Sửa hoán đổi layout trong `recipeShotList` (bắt buộc, không hoãn được)

`scripts/lib/recipeShotList.mjs:317-318` hiện làm:

```js
if (copy.layout && copy.layout !== scene.layout && photoDemandOf(copy) === photoDemandOf(scene)) {
  scene.layout = copy.layout;
  if (copy.photoSlots) scene.photoSlots = copy.photoSlots;
}
```

Với looks, phép hoán đổi này phải là **look → look**:

```js
if (copy.look && copy.look !== scene.look && photoDemandOf(copy) === photoDemandOf(scene)) {
  scene.look = copy.look;
  if (copy.photoSlots) scene.photoSlots = copy.photoSlots;
  Object.assign(scene, resolveScene(scene, { template, library }));   // I2 cho phép
} else if (copy.layout && ...) { /* nhánh cũ giữ nguyên cho recipe chưa migrate */ }
```

Không làm bước re-resolve này thì recipe rơi về hình học library trần **giữa lúc solve**,
im lặng, và chỉ lộ ra trên video cuối.

Tương tự cho `variantOf()` / `mute()`: variant kế thừa `look` của scene nguồn trừ khi
tự khai báo `look` riêng.

### 2.D `muteFallback` phải hỗ trợ `look`

33 scene hiện khai báo `muteFallback.layout`. Đây là nhánh chạy cho **mọi lần lặp không
lời** — tức phần lớn nửa sau của một film dài. Nếu fallback vẫn trỏ layout, recipe mất
cá tính đúng ở chỗ nó cần nhất.

- Schema: `muteFallback` nhận `look` HOẶC `layout` (không nhận cả hai → error mới ở §3.C).
- `photoDemand({ ...scene, ...fallback })` tại `templateRules.mjs:190` phải resolve fallback
  trước khi đo — với I1 thì con số không đổi, nhưng đường đọc phải đúng.

### 2.E Điểm chèn trong `applyStoryTemplate.mjs`

Ngay sau khi `template` được load và trước `planTemplateShotList` (dòng 582):

```js
const looksReport = resolveTemplate(template, { library });
if (looksReport.errors.length) throw new Error(...);   // fail-fast, không render recipe hỏng
template = { ...template, scenes: looksReport.scenes };
```

### Gate Phase 2 — nghiêm ngặt

- `node scripts/runProject.mjs --tier template --dry-run` trên **cùng project, cùng input**
  → timeline **byte-identical** với `temp/looks-baseline-timeline.json`. Khác một byte là
  chưa đạt, phải tìm ra nguyên nhân (thường là clone/merge làm đổi thứ tự key JSON).
- `npm run test:unit` không regression so với baseline.
- `node --test test/tier1-album-regression.test.mjs` xanh.
- Lint vẫn 24 clean.

---

## Phase 3 — Chuyển validation sang hình học đã resolve

Đây là phần sửa lỗ hổng nghiêm trọng nhất. Làm SAU Phase 2 và TRƯỚC khi migrate recipe đầu tiên.

### 3.A Gỡ memo theo layout id

`scripts/lib/rules/templateRules.mjs:121-125`:

```js
const seenLayouts = new Set();
for (const scene of scenes) {
  const layout = layoutOfScene(scene);
  if (!layout || seenLayouts.has(layout.id)) continue;   // ← SAI khi có override
  seenLayouts.add(layout.id);
```

Rule `photo_coverage` (sàn diện tích slot 8%/5%, coverage scene 35%/25%) chạy **một lần
cho mỗi layout id**. Có override, hai look trên cùng `three_photo_row` chỉ được kiểm tra
một lần, trên tọa độ chưa override — lint sẽ **báo pass trên hình học không ai render**.

Sửa: memo theo `visualSignature(scene)` thay vì `layout.id`, và đo trên
`scene.resolvedLayout`.

### 3.B `lookOf()` → `visualSignature()`

`templateRules.mjs:46-50` hiện trả `layer:${scene.layout}`, dùng bởi rule `scene_variety`
(đếm look khác biệt) và `look_adjacency` (cấm hai scene liền nhau cùng look).

Nếu key này đổi thành **tên look**, hai look chỉ khác màu viền sẽ được coi là khác nhau
→ `look_adjacency` ngừng bắt lỗi lặp bố cục, và `scene_variety` bị thổi phồng. Key phải
là fingerprint hình học đã resolve. Import từ `lookResolver.mjs` (I3), xóa bản local.

### 3.C Rule mới trong `evaluateStoryTemplate`

| Rule | Nội dung |
| --- | --- |
| `look_overrides` | Chạy `validateLook` cho mọi look (V1–V7) |
| `look_reachable` | Mọi `scene.look` / `muteFallback.look` / `variant.look` trỏ tới look tồn tại |
| `look_fallback_shape` | `muteFallback` không được vừa có `look` vừa có `layout` |
| `balanced_text` (mở rộng) | `fallbackLayout` lấy qua resolver; `vLayout` ở dòng 197 cũng vậy |

### 3.D Lint phải dùng chung resolver

`scripts/lintStoryTemplates.mjs:36` gọi `evaluateStoryTemplate(template, { library })` —
`evaluateStoryTemplate` tự resolve bên trong, để lint và `applyStoryTemplate` không thể
lệch nhau (I3). Không thêm cờ CLI mới.

### Gate Phase 3

- Lint vẫn 24 clean **và** một fixture cố ý sai (override đẩy slot ra ngoài canvas) phải
  bị bắt — thêm vào `test/story-template-rules.test.mjs`.
- `npm run test:unit` không regression.

---

## Phase 4 — Metric: bỏ `lookCount`, dùng `visualSignature`

`lookCount` hôm nay = số layout id khác biệt, tính tại `server/services/recipes.ts:113`:

```ts
lookCount: new Set(scenes.flatMap((scene) => scene.layout ? [scene.layout] : [])).size,
```

Khi scene chuyển sang `look`, biểu thức này tụt về 0. Và nếu chỉ đổi sang đếm tên look,
một recipe có thể đạt điểm cao trong khi khán giả thấy đúng ba khung hình với ba màu
viền khác nhau.

### Việc phải làm (đồng bộ trong một commit, nếu không API và UI lệch nhau)

| File | Sửa |
| --- | --- |
| `scripts/lib/lookResolver.mjs` | `visualSignature()` = hash của `{resolvedLayout.photoSlots geometry, textSlots geometry, frame, treatment, motion.preset}` |
| `scripts/lib/diversityPlanner.mjs:7` | `layout: scene.layout \|\| scene.effect` → `visualSignature(scene)` |
| `scripts/lib/rules/templateRules.mjs:46` | `lookOf` → import `visualSignature` |
| `server/services/recipes.ts:67,113` | `lookCount` → `signatureCount`; thêm `layoutCount` (số layout khác biệt) và `effectCount` |
| `server/services/recipes.ts:26` | schema scene thêm `look: z.string().optional()` |
| `server/app.test.ts:305` | fixture `lookCount: 8` → tên field mới |
| `apps/web/src/types.ts:56` | `lookCount: number` → 3 field mới |
| `apps/web/src/RecipeLibrary.tsx:87,96` | nhãn "looks" → "signatures" (hoặc giữ chữ "looks" nhưng lấy số từ `signatureCount`) |
| `apps/web/src/AssetsPage.tsx:251` | như trên |

**Quyết định:** `lookCount` không lên UI. Nó là số liệu authoring, thuộc output của lint.

### Gate Phase 4

- `npm run test:api` không regression. `npm run typecheck` sạch (5/5 project).
- Recipe chưa migrate: `signatureCount` phải **bằng đúng** `lookCount` cũ (vì chưa có
  override nào, signature ↔ layout id là song ánh). Đây là phép thử no-op cho metric.

---

## Phase 5 — `photoTreatment` và `motion` (chạm engine)

### 5.1 `saturation` — miễn phí, làm ngay

`ImageSceneLayer.technicalColor` (`src/types.ts:309`, kiểu tại `:316`) đã thông suốt:
`normalizeTimeline.ts:326` → `buildLayerSceneCommand.ts:115` → `buildTechnicalColorFilter`.
Resolver chỉ cần map `look.photoTreatment.saturation` → `layer.technicalColor.saturation`
trong `layerSceneBuilder`. Không đụng TypeScript.

Lưu ý: `applyStoryTemplate.mjs:663-666` gán `slide.technicalColor` từ
`colorNormalizer` **chỉ cho slide không phải `layer_scene`**. Với layer_scene, treatment
của look phải gộp với `averageAdjustments` per-file, không được ghi đè — nếu không, cân
màu tự động giữa các ảnh biến mất trên mọi scene có look.

### 5.2 `contrast` và `vignette`

- `contrast`: **không có** trong `TechnicalColor` (`src/types.ts:316` chỉ có
  `brightness, saturation, redBalance, blueBalance`). Cần thêm field + nhánh trong
  `buildTechnicalColorFilter` (`eq` đã dùng sẵn nên rẻ) + test trong
  `src/buildColorFilters.test.ts`. Chỉ làm nếu có recipe thật cần.
- `vignette`: **loại khỏi phạm vi.** Chỉ tồn tại ở grade toàn cục
  (`src/buildColorFilters.ts:127`). Kể cả khi làm được per-layer, vignette trên một tile
  520×760 trong triptych đọc ra thành viền tối bên trong khung ảnh, không phải không khí.
  Giữ vignette ở tầng scene/recipe defaults.

### 5.3 `transition` — không đưa vào look

Pass 2026-07-26 vừa đổi transition từ "một cut cố định lặp 5–17 lần mỗi film" sang cycle
theo `transitionRole` dựa trên `transitionGrammar` của recipe
(`scripts/lib/transitionGrammar.mjs`). Look ghim cứng `in: "gold_fade"` là đóng băng lại
đúng thứ vừa được mở ra. Look chỉ được khai báo `transitionRole` gợi ý; grammar vẫn cycle.

Nhắc: `transitionGrammar.limits` là một trong hai rule mà `lintStoryTemplates.mjs`
**không** kiểm — chỉ `test/template-recipes.test.mjs:23-31` bắt. Rule còn lại là tổng
opacity overlay ≤ 0.3 (`test/template-recipes.test.mjs:14-22`). Khi sửa recipe phải chạy
`npm run test:unit`, không chỉ chạy lint.

### 5.4 `motion.stagger`

Stagger hiện là global: `templateTheme.mjs:87-99` (`photoStart`, `textStart`) đọc
`designTokens.motionPresets.staggerSeconds`. Đưa xuống per-look = luồn thêm một tham số
tùy chọn qua `createTemplateTheme` → `createLayerSceneBuilder`. Rẻ, đáng làm, không đụng engine.

---

## Phase 6 — Migrate recipe, mỗi lần một cái

### Thứ tự đề xuất

1. **`jmii-silk-botanical-01`** — đã có `layoutPresets.arch`, là ca dễ nhất và chứng minh
   được đường `layoutPresets → look.frame`.
2. **`white-weddings-full-01`** — 21 scene, nhiều nhất, và có `source.notes` cam kết bám
   sát bản gốc Canva; là phép thử ngặt nhất cho V5 (text occlusion).
3. **`cinematic-film-01`** — mở bằng `dark_feather` (không phải layer_scene), thử nhánh
   scene không có look.
4. Còn lại theo thứ tự bảng chữ cái.

### Checklist cho mỗi recipe

- [ ] Xác định 3–6 look thật sự khác nhau về hình học/frame, không phải khác vài màu
      (V7 sẽ cảnh báo nếu chỉ khác tên).
- [ ] Mọi `muteFallback.layout` → `muteFallback.look` (recipe này có bao nhiêu: đếm trước).
- [ ] Mọi `repeatable.variants[].layout` → `.look` nếu variant đổi bố cục.
- [ ] `node scripts/lintStoryTemplates.mjs --template story-templates/<file>.json` → clean.
- [ ] `npm run test:unit` không regression.
- [ ] Dry-run thật: `node scripts/runProject.mjs --tier template --dry-run` trên một
      project có ảnh thật; kiểm `analysis/tier1_diversity.json` — `signatureCount` phải
      **tăng hoặc giữ nguyên**, không được giảm.
- [ ] Commit riêng, message nêu rõ recipe nào và số look.

### Điểm dừng bắt buộc

Sau recipe **thứ ba**: dựng thật một video từ mỗi recipe đã migrate và xem. Nếu ba film
đó không nhìn ra khác nhau, vấn đề nằm ở nội dung look chứ không ở kiến trúc — dừng
migrate, sửa cách viết look trước.

---

## Phase 7 — Quyết định về premium / scene composed

**Vấn đề.** `layoutsByPhotoCount(library)` (`scripts/lib/engineCapabilities.mjs:212`) là
thứ chào layout cho director. Looks nằm trong recipe nên không xuất hiện ở đó. Premium vẫn
đi qua `applyStoryTemplate` với một recipe, nhưng scene `origin:"composed"` do director
sinh chỉ biết `layout`, không biết `look`.

Hệ quả nếu không xử lý: **film premium trông ít cá tính hơn film template** — ngược với
bậc thang sản phẩm 3 tầng.

**Hai lựa chọn** (cần chốt trước Phase 6, vì nó đổi hình dạng `looks`):

- **(A) Expose looks cho director.** Thêm `looksByPhotoCount(template, library)` vào
  `engineCapabilities.mjs`, đưa vào palette của `composeStoryboard.mjs`. Director chọn look
  thay vì layout. Đắt hơn, nhưng premium hưởng trọn.
- **(B) Premium giữ layout-only.** Recipe looks chỉ phục vụ tier template/lite. Premium
  bù cá tính bằng director palette + hybrid scene. Rẻ, nhưng phải chấp nhận nghịch lý trên.

Khuyến nghị: **(A)**, nhưng làm sau khi ≥3 recipe đã migrate xong và hình dạng `looks`
đã ổn định. Đừng thiết kế cho director trước khi biết look thật trông thế nào.

---

## Phase 8 — Tài liệu

**Bẫy cần biết:** `scripts/checkDocs.mjs:32-38` quét mọi file `.md` **trong `docs/`** và
báo lỗi nếu văn bản nhắc tới một tên file `.mjs/.ts/.tsx` chưa tồn tại trong repo, hoặc
một `npm run <script>` không có trong `package.json`. Nghĩa là: **không được viết
`lookResolver.mjs` vào `docs/*.md` trước khi file đó tồn tại** — `npm run docs:check` sẽ
đỏ và kéo theo `npm run check`.

Vì vậy file plan này nằm ở **repo root**, không nằm trong `docs/`.

Tài liệu chính thức viết ở Phase 8, sau khi code đã có:

- `docs/TEMPLATE-RULES.md` — thêm mục `look_overrides`, `look_reachable`,
  `look_fallback_shape`, và ghi lại vì sao memo theo layout id bị gỡ.
- `docs/generation-guide.md` — chương "Viết look cho recipe": schema, 5 nấc merge, V1–V7,
  ví dụ đầy đủ từ recipe đã migrate đầu tiên.
- `docs/current-state.md` — cập nhật tracker.
- `layouts/library.json` → `meta.layoutRules` — một câu nói rõ library chỉ giữ primitive,
  look thuộc recipe.
- Xóa `LOOKS-MIGRATION-PLAN.md` (file này) khi Phase 8 xong.

---

## 9. Bảng gate tổng hợp

| Phase | Lệnh phải chạy | Điều kiện đạt |
| --- | --- | --- |
| 0 | lint, `test:unit` | 24 clean; không regression; resolver là no-op chứng minh được |
| 1 | `test:unit` | V1–V7 có test dương + âm |
| 2 | dry-run + lint + `test:unit` + `test:tier1-albums` | **timeline byte-identical** với baseline |
| 3 | lint + `test:unit` | fixture sai bị bắt; 24 recipe vẫn clean |
| 4 | `test:api` + `typecheck` | `signatureCount` == `lookCount` cũ trên recipe chưa migrate |
| 5 | `test:api` (`buildColorFilters.test.ts`) | chỉ khi thực sự thêm `contrast` |
| 6 | lint từng file + `test:unit` + dry-run | `signatureCount` không giảm |
| 7 | — | quyết định (A)/(B) được ghi vào `docs/current-state.md` |
| 8 | `npm run docs:check` | 0 lỗi |

---

## 10. Rủi ro và cách lùi

| Rủi ro | Dấu hiệu | Lùi |
| --- | --- | --- |
| Resolver mutate library | Scene thứ hai dùng cùng layout bị lệch hình | Deep-clone bắt buộc + test không-mutate ở 0.C |
| Phase 2 không byte-identical | diff timeline khác thứ tự key | Thường do spread object; sắp lại thứ tự merge, không nới lỏng gate |
| `photoDemand` lệch | assignment throw "could not fill" ở scene xa chỗ gây lỗi | V3 `slot_count_drift` bắt từ lint, trước khi render |
| Recipe mất cá tính khi lặp | Nửa sau film trông như library trần | 2.C + 2.D; kiểm bằng dry-run có music dài |
| Metric bị thổi phồng | `signatureCount` cao nhưng video nhìn đơn điệu | V7 `look_is_noise` + điểm dừng bắt buộc ở Phase 6 |
| Phiên Claude song song sửa cùng file | Test đỏ ở chỗ không liên quan | So với `temp/looks-baseline.txt`, không so với "0 fail" |

Mỗi phase là một commit riêng trên `agent/refactor-engine-and-add-momo` (hoặc nhánh
`agent/recipe-looks` tách ra). Lùi = `git revert` một phase, vì Phase 0–5 không đụng nội
dung recipe nào.
