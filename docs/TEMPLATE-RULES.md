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

## Ghi chú layout library

- `textRequired: true` trong `layouts/library.json` đánh dấu layout mà chữ là một nửa
  bố cục. Thêm layout mới kiểu này thì phải thêm cờ, lint mới biết đường bắt.
- Các slot quá nhỏ đã được nới (2026-07-18): `invitation_row` 4×360×510,
  `journey_duo.accent` 380×520, `polaroid_feature.feature` 900×870,
  `quad_grid_caption.wide` 520×330, `duo_tinted_spread` 2×800×520.

## Khi thêm template mới

1. Viết template như cũ (xem `story-templates/warm-film-01.json` làm mẫu đầy đủ:
   `muteFallback`, `params.background`, cảnh hybrid, variants).
2. Chạy `node scripts/lintStoryTemplates.mjs --template <file>` tới khi sạch.
3. Màu `params.background` gợi ý theo theme: white_weddings `#4A4139`, dark_film
   `#2B2B32`, editorial_bold `#34322E`, warm_film `#3B332B`, modern_teal `#2F3B3A`.
