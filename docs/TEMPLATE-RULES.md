# Luật soạn story-template (Template Authoring Rules)

Bộ luật này sinh ra từ việc xem lại các video render thật từ story-templates. Mỗi luật
tương ứng một lỗi đã nhìn thấy trên màn hình — không phải lý thuyết:

| # | Hiện tượng đã thấy | Luật | Mã check |
|---|---|---|---|
| 1 | Template ít cảnh/hiệu ứng rồi lặp lại | ≥ 8 cảnh, ≥ 6 "look" khác nhau | `scene_variety` |
| 2 | Cảnh giống nhau đứng cạnh nhau ở các slide liên tiếp | Không có 2 cảnh kề nhau cùng look trong thứ tự soạn; solver đã tự tránh khi lặp | `look_adjacency` |
| 3 | Clip stock chiếu đi chiếu lại | ≤ 2 cảnh `video_background`, không trùng clip | `photoless_repetition` |
| 4 | Ảnh nhỏ quá bé so với nền | Slot ảnh ≥ 8% canvas (grid ≥ 6 slot: ≥ 5%); tổng diện tích ảnh mỗi layer_scene ≥ 35% (layout `textRequired`: ≥ 25%) trừ khi nền là ảnh full-bleed | `photo_coverage` |
| 5 | Ảnh nổi trên nền đen tuyền, cảm giác trống rỗng | `mask_reveal`/`memory_wall` phải khai `params.background` (hex, luma ≥ 20) — engine đã hỗ trợ, mặc định vẫn đen để không đổi phim cũ | `canvas_background` |
| 6 | Slide ảnh lệch một bên, nửa còn lại trống | Layout `textRequired` (photo_left_text_right, text_left_photo_right, collage_cluster_text, polaroid_feature, journey_duo, welcome_title_page) phải luôn có chữ ở cảnh gốc và MỌI variant; cảnh body phải khai `muteFallback` (layout cân, cùng số ảnh) để lần lặp hết-lời đổi bố cục thay vì bỏ trống nửa khung | `balanced_text` |
| 7 | Thiếu hiệu ứng mới Remotion/Blender | Mỗi template ≥ 1 cảnh signature hybrid (chỉ template `assets=1`, hoặc `gl_transition`; ≤ 1 cảnh Blender vì tốn nhiều phút render) | `signature_hybrid` |
| 8 | Bài dài → cảnh lặp câm hàng loạt | ≥ 2 cảnh body có `repeatable.variants` ≥ 2 | `repeat_depth` |
| 9 | Zoom to cắt mất mặt | Không hardcode `motion: zoom_*` trên slot `orient: portrait` — để motionPlanner (biết mặt ở đâu) quyết định | `face_safe_motion` |
| 10 | Look đè lên hình học không hợp lệ | Override chỉ được sửa slot đã có (không thêm/xoá/đổi tên), ảnh không được lệch khỏi canvas quá nửa, chữ phải nằm trong safe margin, ảnh không được che >20% một text slot; look khai mà không dùng, hoặc hai look ra cùng một khung, là warning | `look_overrides` |
| 11 | Look trỏ vào hư vô | `scene.look`, `muteFallback.look`, `variant.look` phải trỏ tới look recipe có khai | `look_reachable` |
| 12 | Stand-in mập mờ | `muteFallback`/variant chỉ được khai `look` HOẶC `layout`, không cả hai | `look_fallback_shape` |

Ngưỡng số nằm ở `scripts/lib/rules/thresholds.mjs` (khối "story-template authoring
rules"). Logic check ở `scripts/lib/rules/templateRules.mjs`.

## Chạy lint

```bash
node scripts/lintStoryTemplates.mjs                       # toàn bộ story-templates/
node scripts/lintStoryTemplates.mjs --template story-templates/warm-film-01.json
```

`test/story-template-rules.test.mjs` chạy cùng bộ check trong `npm run test:unit`, nên
template vi phạm sẽ đỏ CI chứ không đợi tới lúc render cho khách.

## Các cơ chế engine đi kèm (đã có sẵn, template chỉ cần dùng)

- **`params.background`** trên `mask_reveal` / `memory_wall`: hex `#RRGGBB`, thay nền
  đen cứng của canvas (src/buildFfmpegCommand.ts — `canvasBackground()`).
  applyStoryTemplate truyền `scene.params` qua nguyên vẹn.
- **`muteFallback`** trên cảnh của recipe: khi solver lặp một cảnh quá số variant tác
  giả viết, cảnh được "mute" (bỏ lời). Với layout nửa-chữ-nửa-ảnh, mute = nửa khung
  trống — `muteFallback` khai layout thay thế (vd `full_bleed_quote`, `photo_duo`,
  `paper_collage`) cùng số ảnh, solver tự áp (scripts/lib/recipeShotList.mjs `mute()`).
- **Cap lặp là luật cứng trong solver**: `repeatable.maxRepeats` giờ áp cho cả vòng
  cycle authored (trước chỉ áp cho substitute). `mask_reveal` và mọi cảnh hybrid
  (renderer+template) bị cap 1 lần/phim — chúng là dấu chấm câu, không phải đoạn văn.
- **Ken-burns face-safe**: `kenburns_*` giờ nhận `faceSafeMaxZoom` + `faceBox` như
  `slow_zoom_*`; biểu thức crop theo mặt đã được quote đúng (lỗi
  `No such filter: 'min(iw-ow'` khi ảnh có faceBox rơi vào slide zoompan đã sửa).
- **motionPlanner** không còn coi ảnh chưa phân tích mặt là "ảnh chi tiết" để đẩy zoom
  mạnh nhất — thiếu dữ liệu thì đi motion nhẹ (0.025).

## Recipe looks — thư viện giữ hình học, recipe giữ cá tính

`layouts/library.json` giữ **primitive**: các khung toạ độ luôn hợp lệ trên canvas
1920×1080. Recipe khai `looks` — mỗi look chọn một primitive rồi khoác lên nó hình học
được nhích nhẹ, khung viền, sắc độ ảnh, nhịp vào. Cảnh trỏ tới look thay vì layout trần:

```jsonc
"looks": {
  "bride_arch": {
    "intent": "cô dâu, thành một thẻ ảnh bo góc trên nền kem",
    "layout": "text_left_photo_right",
    "layoutOverrides": {
      "photoSlots": { "hero": { "x": 1090, "y": 90, "width": 700, "height": 900 } }
    },
    "frame": "arch",                        // tên preset trong layoutPresets, hoặc object
    "photoTreatment": { "saturation": 0.92 }, // → ImageSceneLayer.grade, KHÔNG phải technicalColor
    "motion": { "stagger": 0.14 }
  }
}
```
```jsonc
{ "id": "s03_bride", "effect": "layer_scene", "look": "bride_arch", "photoSlots": [...] }
```

Thứ tự merge (`scripts/lib/lookResolver.mjs`, một nơi duy nhất — lint và build dùng chung):

```
library layout  →  look.layoutOverrides  →  scene.photoSlots/text
frame: scene slot → look.frame → layout slot → layoutPresets → designTokens.framePreset
```

Ràng buộc quan trọng nhất: **override chỉ được sửa slot đã tồn tại**. `photoDemand()` tính
ngân sách ảnh bằng `layout.photoSlots.length`, nên số slot cố định là thứ cho phép cả tầng
solver không cần biết look tồn tại. Luật `look_overrides` (V2/V3) chặn việc này ở CI.

`scene.layout` vẫn dùng được bình thường và không bị bỏ — recipe chuyển sang look từng cái
một, và một recipe có thể trộn cả hai. Cảnh nào dùng đúng layout thư viện thì cứ khai
`layout`; chỉ tạo look khi recipe thực sự có cá tính riêng ở beat đó.

Đo lường: `signatureCount` (số khung hình khác nhau) / `layoutCount` (số primitive) /
`effectCount`. Không đếm số look — hai look chỉ khác cái viền không phải hai khung hình,
và luật `look_overrides` sẽ cảnh báo nếu chúng resolve ra cùng một fingerprint.

## Ghi chú layout library

- `textRequired: true` trong `layouts/library.json` đánh dấu layout mà chữ là một nửa
  bố cục. Thêm layout mới kiểu này thì phải thêm cờ, lint mới biết đường bắt.
- Các slot quá nhỏ đã được nới (2026-07-18): `invitation_row` 4×360×510,
  `journey_duo.accent` 380×520, `polaroid_feature.feature` 900×870,
  `quad_grid_caption.wide` 520×330, `duo_tinted_spread` 2×800×520.

### Bảy primitive lệch lưới (2026-07-31)

Thư viện có thêm bảy layout cố ý phá lưới: `overlap_stack_duo`, `inset_card_hero`,
`circle_trio_stagger`, `diagonal_staircase_trio`, `golden_column_pair`,
`stacked_horizon_trio`, `offset_portrait_hero`. Mô tả từng cái ở
[docs/generation-guide.md](generation-guide.md) §5. Ba luật khi dùng chúng:

- **Không đặt `frame` toàn cục lên look mặc primitive tự sở hữu frame.**
  `circle_trio_stagger`, `overlap_stack_duo`, `inset_card_hero` gắn frame ngay trên photo
  slot. Precedence `def.frame → resolvedFrame → slot.frame` khiến frame ở cấp look **xoá
  im lặng** medallion tròn hoặc mép card — không lỗi, không cảnh báo, chỉ mất hình.
- **Resize slot tròn thì phải override luôn `frame`** với radius bằng nửa cạnh mới. Slot
  600px đeo `circleMedallion` (radius 260) ra hình bo góc chứ không phải hình tròn. Cách
  sạch: khai preset tròn riêng trong `layoutPresets` của recipe.
- **`stacked_horizon_trio` chỉ dùng khi mọi request là `orient: "landscape"`.** Ba dải
  ngang cắt xuyên mặt nếu nhận ảnh dọc. Giữ aspect từng dải ≤4:1 và coverage ≥50%.

Hai primitive `offset_quad_pinwheel` và `filmstrip_band` có trong thư viện nhưng **chưa
được dùng**: chúng đưa photo demand lên 4 và 5, tức đổi ngân sách của solver.

### Trùng hình học không hiện ra ở `visualSignature`

`compositionUniquenessAudit` (trong `scripts/adoptNewPrimitives.mjs`) tính cả `frame` và
`photoTreatment`, nên **hai recipe vẽ đúng cùng một bộ khung hình vẫn qua được nó** miễn là
khác lớp áo. Thước đo hình học thuần là `authored.shared` trong
`scripts/lib/geometrySignature.mjs`, và `test/layout-geometry.test.mjs` khoá nó ở `<=30`.
Khi cho hai recipe cùng dùng một layout, hãy cho mỗi recipe một `layoutOverrides` **riêng** —
override giống hệt nhau nghĩa là cùng một hình.

## Khi thêm template mới

1. Viết template như cũ (xem `story-templates/warm-film-01.json` làm mẫu đầy đủ:
   `muteFallback`, `params.background`, cảnh hybrid, variants). Muốn recipe có nhận diện
   riêng thì thêm `looks` — `story-templates/jmii-silk-botanical-01.json` là mẫu đã
   chuyển hoàn chỉnh (7 look, quiet fallback tách đôi).
2. Chạy `node scripts/lintStoryTemplates.mjs --template <file>` tới khi sạch, rồi
   `npm run test:unit` — có 2 luật lint **không** kiểm (tổng opacity overlay ≤ 0.3 và
   `transitionGrammar.limits`), chỉ `test/template-recipes.test.mjs` bắt.
3. Màu `params.background` gợi ý theo theme: white_weddings `#4A4139`, dark_film
   `#2B2B32`, editorial_bold `#34322E`, warm_film `#3B332B`, modern_teal `#2F3B3A`.
