# Năng lực đầy đủ của Render Engine

Tài liệu này mô tả **toàn bộ khả năng** của wedding slideshow render engine ở trạng thái
hiện tại của mã nguồn (`src/`). Mọi con số, enum, giới hạn bên dưới đều lấy trực tiếp từ
`src/types.ts`, `src/validateTimeline.ts`, `src/quality.ts` — đây là "single source of truth".

> Nguyên tắc thiết kế (docs/01): **AI ra quyết định → JSON là hợp đồng → Engine thực thi.**
> AI không dựng pixel. Engine biến `timeline.json` + ảnh + nhạc thành `output/final.mp4` qua FFmpeg.

---

## 1. Tổng quan

| Hạng mục | Giá trị |
|---|---|
| Đầu vào | 1 file `timeline.json` + ảnh (JPG/PNG) + nhạc (mp3…) local |
| Đầu ra | 1 file MP4 (H.264 + AAC, `yuv420p`, `+faststart`) |
| Độ phân giải | Tùy chỉnh `project.width/height/fps` — mặc định khuyến nghị 1920×1080 @ 30fps |
| Nền tảng | Node + TypeScript (tsx), gọi FFmpeg CLI; chạy local trên Windows |
| Phụ thuộc runtime | `zod` (validate) + FFmpeg (ffmpeg + ffprobe) |
| Số effect ảnh | **29 preset** |
| Số transition | **56 kiểu** (+ `none`) |

---

## 2. Pipeline render (thứ tự thực thi trong `src/index.ts`)

```
timeline.json
  → readJson            (đọc + parse JSON)
  → normalizeTimeline   (điền default, gộp field legacy: caption đơn → captions[], music đơn → music[])
  → validateTimeline    (Zod cấu trúc + kiểm tra ngữ nghĩa: id trùng, file tồn tại, ràng buộc thời lượng)
  → applyFaceSafeFraming (đổi cover→contain cho layer ảnh có nguy cơ cắt mặt cao)
  → preflightTimeline   (báo cáo trước khi render: số slide/ảnh/nhạc, thời lượng ước tính, cảnh báo)
  → preprocessTimelineImages (thu nhỏ ảnh quá lớn vào temp/image-cache — không sửa ảnh gốc)
  → compileTimeline     (dựng RenderPlan: mỗi slide → 1 lệnh ffmpeg cụ thể)
  → renderSlides        (render từng slide ra video tạm trong temp/)
  → renderFinal         (ghép transition + overlay + trộn nhạc → output cuối)
```

**Mã thoát (exit code):** `0` thành công · `1` lỗi validate · `2` lỗi FFmpeg · `99` lỗi không xác định.

**Chế độ `--dry-run`:** chạy toàn bộ validate/preflight/compile và in lệnh FFmpeg mà **không** render
(dùng để kiểm tra timeline nhanh, không tốn thời gian encode).

---

## 3. Project & chất lượng đầu ra

`project`: `name`, `width`, `height` (số nguyên dương), `fps` (số nguyên dương), `quality`.

`project.quality` chọn tốc độ ⇄ dung lượng ⇄ chất lượng (áp dụng cho encode slide, ghép xfade,
re-encode overlay và mux audio; nếu **mọi** transition là `none` thì ghép bằng stream-copy, không re-encode):

| Preset | x264 preset | CRF | Audio | Dùng khi |
|---|---|---|---|---|
| `draft` | veryfast | 28 | 128k | Xem thử nhanh |
| `share` *(mặc định)* | medium | 20 | 192k | Bản gửi khách cân bằng |
| `high` | slow | 18 | 256k | Bản lưu trữ/giao khách chất lượng cao |
| `master` | slow | 16 | 320k | Bản master cao nhất |

Encode cố định: `libx264`, `-pix_fmt yuv420p`, `-movflags +faststart`, audio `aac`.

---

## 4. Đầu vào mỗi slide

Mỗi slide dùng **đúng một** kiểu nguồn ảnh, tùy theo `effect`:

| Trường | Dùng cho |
|---|---|
| `image` | Hầu hết effect 1 ảnh |
| `images[]` | Effect nhiều ảnh: `film_roll_up/left/right`, `collage_grid`, `double_exposure` (≥2 ảnh), `memory_wall` (1–5 ảnh) |
| `background` | `video_background` (1 file video lặp) |
| `layers[]` | `layer_scene` (≥1 layer) |

---

## 5. Effect ảnh (29 preset — `effect`)

**Chuyển động Ken Burns / pan (1 ảnh, cover-crop 16:9):**
- `still` — ảnh tĩnh, cover-fill.
- `slow_zoom_in`, `slow_zoom_out` — zoom vào/ra, đã **eased** (smoothstep).
- `pan_left`, `pan_right`, `pan_up`, `pan_down` — lia chậm 4 hướng.
- `kenburns_tl`, `kenburns_tr`, `kenburns_bl`, `kenburns_br` — zoom + trôi về 4 góc (điện ảnh hơn pan thẳng).

> **Easing tùy chọn** (chỉ 10 effect zoom/pan/kenburns trên): thêm `easing` vào slide để
> đổi cảm giác chuyển động mà không đổi quãng đường. Bỏ trống = smoothstep mặc định.
> `gentle` = smootherstep (vào/ra cực êm — slide cảm xúc, chân dung) · `snap` = ease-out
> quart, bốc nhanh dừng dứt khoát (tiệc, cao trào) · `bounce` = vượt nhẹ cuối rồi lún về
> (điểm nhấn, tối đa 1–2 slide/video). Validate **từ chối** `easing` trên effect ngoài
> nhóm này. Bảng curve chi tiết ở cuối §5.

**Khung / phong cách ảnh (1 ảnh):**
- `portrait_blur_background` — ảnh dọc giữ nguyên, đặt trên nền chính nó đã làm mờ phủ kín khung (không cắt người). Ảnh dọc thường được engine tự động route sang đây.
- `polaroid` — ảnh fit trong thẻ ảnh chụp lấy liền trắng, nghiêng nhẹ, viền dày dưới, trôi nổi trên nền mờ. **Không bao giờ cắt** ảnh. Kiểu scrapbook/hoài niệm.
- `circle_focus` — cắt vuông tâm ảnh, mask tròn + vòng trắng, trên nền mờ. Hợp chân dung/close-up (chủ thể nên ở giữa ảnh).
- `double_exposure` — chồng phơi sáng 2 ảnh (screen blend + zoom eased). Cần 2 ảnh.
- `tilt_shift` — effect native tạo một dải nét ngang và làm mờ vùng ngoài bằng Gaussian blur + mask feather. Tùy chỉnh bằng `tiltShift: { focusY: 0..1, bandHeight: 0.05..0.8, blur: 1..40 }`; mặc định `{ focusY: 0.5, bandHeight: 0.22, blur: 14 }`. Alias: `tiltshift`, `miniature`.
- `dream_glow` — bloom kiểu Orton: lớp ảnh mờ sáng được screen-blend lên ảnh gốc, tạo chất mềm và lãng mạn. Alias: `orton`.
- `prism_split` — lệch kênh đỏ/xanh tạo viền sắc sai và cảm giác lăng kính hiện đại. Alias: `chromatic_aberration`.
- `spotlight_focus` — vignette quang học mạnh, đặt tâm hơi cao để hướng mắt vào chủ thể. Alias: `spotlight`.
- `mirror_split` — chia đôi và phản chiếu khung hình thành bố cục đối xứng mang tính editorial. Alias: `mirror`.

**Phong cách "dark film" (thay caption thường bằng lockup chữ):**
- `memory_wall` — 1–5 ảnh dạng thẻ in/âm bản nghiêng trên nền gần đen, có đường timeline mảnh. Caption trở thành lockup: `title`=tên serif lớn, `subtitle`=năm trên đường kẻ, `caption`=dòng nhỏ dưới. Chữ nằm trái/phải xác định theo slide id. Dùng transition `slide_left` giữa các scene để có cảm giác lia dọc bức tường.
- `dark_feather` — 1 ảnh giữ nguyên tỉ lệ gốc trên nền đen, viền tan mềm vào nền, cùng lockup chữ như `memory_wall`. Render **chậm** (feather từng pixel) — dùng cho vài khoảnh khắc hero. Hai effect này **bỏ qua** `caption.position`; vai trò (role) quyết định vị trí.

**Cuộn phim (nhiều ảnh, kiểu Fujifilm):**
- `film_roll_up` — dải phim cuộn lên (dọc).
- `film_roll_left` — dải phim ngang chạy phải→trái.
- `film_roll_right` — dải phim ngang chạy trái→phải.

**Nền video & ghép nhiều ảnh:**
- `video_background` — 1 video nền lặp làm slide (dùng file video, không phải ảnh tĩnh).
- `collage_grid` — lưới nhiều ảnh có khung, trên nền mờ (2–6 ảnh).

**Cảnh dàn layer thủ công:**
- `layer_scene` — cảnh kiểu Canva, đặt ảnh/text/khối nền tại tọa độ chính xác. Xem §7.

**Alias được `normalize` chấp nhận:** `collage`/`photo_grid`→`collage_grid`; `background_video`/`title_card`/`intro_card`→`video_background`; `polaroid_card`/`photo_card`/`instant_photo`→`polaroid`; `circle_frame`/`circle_photo`/`circle_mask`→`circle_focus`; `photo_scatter`/`film_scatter`/`timeline_wall`→`memory_wall`; `feather`/`feathered_photo`/`soft_frame`→`dark_feather`; `tiltshift`/`miniature`→`tilt_shift`; `orton`→`dream_glow`; `chromatic_aberration`→`prism_split`; `spotlight`→`spotlight_focus`; `mirror`→`mirror_split`.

### Bảng easing (chỉ effect zoom/pan/kenburns)

| `easing` | Curve | Cảm giác | Dùng cho |
|---|---|---|---|
| *(bỏ trống)* | smoothstep t²(3−2t) | mượt chuẩn house-style | mặc định |
| `gentle` | smootherstep t³(6t²−15t+10) | vào/ra cực êm | slide cảm xúc, chân dung, khoảnh khắc lắng |
| `snap` | ease-out quart 1−(1−t)⁴ | bốc nhanh, dừng dứt khoát | slide tiệc, nhảy, cao trào |
| `bounce` | ease-out-back (s=1.5), chuẩn hoá đỉnh = 1.0 | vượt nhẹ cuối rồi lún về ~7% | điểm nhấn — tối đa 1–2 slide/video |

`bounce` được chia cho đỉnh 1.08 để overshoot chạm đúng 100% quãng đường rồi lún về —
nhờ vậy clamp zoom và slack pan hiện có vẫn đúng (nếu không, zoompan âm thầm cắt phẳng
phần vượt biên). `layer_scene` `motion` vẫn dùng smoothstep, chưa nhận `easing`.

---

## 6. Transition (56 kiểu + `none`)

`transition = { type, duration }`. `duration` từ 0–2s và **phải nhỏ hơn** thời lượng slide.
Chuỗi transition khác kiểu vẫn được nối trong **một** xfade chain; biên `none` thành fade 1 khung.

- **Fade:** `crossfade`, `fade_fast`, `fade_slow`, `fade_to_black`, `fade_to_white`, `fade_grays`, `dissolve`
- **Hiệu ứng mẫu:** `pixelize`, `radial`, `distance`, `blur`, `zoom_in`
- **Wipe:** `wipe_left/right/up/down`, `wipe_tl/tr/bl/br`
- **Slide/Smooth:** `slide_left/right/up/down`, `smooth_left/right/up/down`
- **Hình học:** `circle_open/close/crop`, `rect_crop`, `horz_open/close`, `vert_open/close`, `diag_tl/tr/bl/br`
- **Slice/Wind:** `slice_left/right/up/down`, `wind_left/right/up/down`
- **Cover/Reveal:** `cover_left/right/up/down`, `reveal_left/right/up/down`
- **Squeeze:** `squeeze_h`, `squeeze_v`
- `none` — không chuyển cảnh (cho phép ghép stream-copy nhanh).

Thời lượng khuyến nghị: cảm xúc mềm 0.8–1.5s · montage nhanh 0.35–0.75s.

---

## 7. `layer_scene` — dàn cảnh chính xác

Mỗi phần tử trong `layers` là `image` / `rect` / `text`, vẽ từ sau ra trước.

**Trường chung mọi layer:** `x`, `y`, `width`>0, `height`>0, `opacity` (0–1), `rotation` (−360…360°),
`start` (giây từ đầu slide), `duration` (tùy chọn), `animation` (hiệu ứng vào).

`animation`: `none` · `fade` · `slide_up` · `slide_down` · `slide_left` · `slide_right` (đều eased).

**Layer `image`:** `path`, `fit` (`cover`/`contain`/`stretch`), thêm:
- `motion` — Ken Burns liên tục cả slide: `zoom_in`/`zoom_out`/`pan_left`/`pan_right`/`pan_up`/`pan_down`.
- `frame` — thẻ ảnh `{ radius (0–400), border (0–200), borderColor, shadow }` (bo góc, viền matte giữ kích thước ngoài, đổ bóng mềm).
- `focusX`, `focusY` (0–1) — điểm neo khi cover-crop (mặc định 0.5 = giữa). Cho phép crop lệch để giữ mặt.

**Layer `rect`:** khối màu đặc `color` (góc vuông).

**Layer `text`:** `text`, `font` (tùy chọn .ttf/.otf), `size`, `color`, `align` (`left`/`center`/`right`),
`lineSpacing`, `letterSpacing`, `wrap:true` (tự xuống dòng theo bề rộng layer lúc compile — khỏi `\n` thủ công).

> Lưu ý: `drawtext` **không** tự wrap nếu không bật `wrap`; `letterSpacing` chỉ bật text-shaping, không giãn ký tự thật.

---

## 8. Caption (chữ nung vào từng slide)

`slide.captions[]` — mỗi caption:

| Trường | Giá trị |
|---|---|
| `text` | Hỗ trợ tiếng Việt (đọc từ file UTF-8, không cần escape) |
| `role` | `title` · `subtitle` · `caption` (preset cỡ chữ theo chiều cao khung) |
| `position` | `top_center` · `center` · `bottom_center` · `none` |
| `start`, `duration` | giây (trong phạm vi thời lượng slide) |
| `font` | đường dẫn .ttf/.otf (mặc định env `CAPTION_FONT`, fallback Arial) |
| `size` | px override (tùy chọn) |
| `color` | tên màu hoặc `#rrggbb` (mặc định trắng) |
| `outline` | `{ color, width (0–20) }` |
| `shadow` | bật/tắt đổ bóng mềm |
| `animation` | `fade` · `slide_up` · `none` |

Emoji **không** render (font không có glyph emoji → hiện ô vuông).

---

## 9. Color grading (`color` — cấp timeline và/hoặc từng slide)

`color` cấp timeline áp cho mọi slide; `color` cấp slide **merge đè** lên global. Áp trước caption.

| Trường | Khoảng | Ý nghĩa |
|---|---|---|
| `brightness` | −1…1 | độ sáng (0 = giữ nguyên) |
| `contrast` | 0…3 | tương phản (1 = giữ nguyên) |
| `saturation` | 0…3 | bão hòa màu |
| `gamma` | 0.1…10 | gamma |
| `curves` | preset | đường cong tông màu (xem dưới) |
| `lut` | đường dẫn `.cube` | 3D LUT |
| `vignette` | bool \| 0…π | tối 4 góc |
| `sharpen` | 0…2 | làm nét (unsharp) |
| `blur` | 0…50 | mờ Gaussian (soft-focus) |
| `temperature` | 1000…40000 K | nhiệt màu (6500=trung tính, thấp hơn=ấm hơn) |
| `glow` | 0…1 | bloom mơ màng |
| `grain` | 0…30 | hạt phim động |
| `letterbox` | bool \| 1…4 | thanh đen điện ảnh (true=2.39:1, số=tỉ lệ đích) |

**`curves` preset:** `color_negative`, `cross_process`, `darker`, `increase_contrast`, `lighter`,
`linear_contrast`, `medium_contrast`, `negative`, `strong_contrast`, `vintage`.

---

## 10. Overlay (phủ lên toàn bộ video — `overlays[]`)

Logo, watermark, khung PNG trang trí, loop bokeh / light-leak.

| Trường | Giá trị |
|---|---|
| `path` | `.png`/`.jpg` = ảnh (dùng alpha); `.mp4`/`.mov`/`.webm` = video lặp |
| `variant` | light leak đóng gói sẵn: `warm`/`soft`/`sunset` — **thay cho** `path` (không khai cả hai). Tự đặt `blend: "screen"`, `opacity: 0.6` |
| `position` | `fullscreen` · `center` · `top_left` · `top_right` · `bottom_left` · `bottom_right` |
| `scale` | 0.01…1 — bề rộng overlay theo tỉ lệ khung (bỏ qua khi fullscreen) |
| `opacity` | 0…1 (variant mặc định 0.6) |
| `margin` | 0…500 px (lề khi đặt góc) |
| `blend` | `alpha` (PNG trong suốt/logo/khung) · `screen` (loop nền đen: bokeh/light-leak) · `add` (như screen nhưng gắt hơn, dễ cháy sáng — hạ opacity) |
| `start`, `end` | thời điểm hiện/ẩn (giây trong video cuối) |

**Light leak đóng gói sẵn** (`overlays/light_leak_{warm,soft,sunset}.mp4`, sinh
procedural bằng `node scripts/generateLightLeaks.mjs` — loop liền mạch 10s, không dùng
footage ngoài): `warm` = quầng vàng ấm góc phải trên (hợp look dark-film/hoài niệm),
`soft` = dải trắng nhẹ cạnh trên (theme cream), `sunset` = cam + hồng tím quét từ trái
(hoàng hôn). Khai bằng `variant` (khỏi `path`); đổi variant hoặc giới hạn `start`/`end`
để leak không lặp một kiểu suốt video dài. Khuyến nghị opacity 0.4–0.7.

```json
{ "variant": "warm", "opacity": 0.55, "start": 12, "end": 26 }
```

Asset local: `overlays/` (particles + 3 light-leak đóng gói), `assets/overlays/`
(bokeh/light mixkit), `assets/backgrounds/`, `assets/frames/`. Chi tiết + license:
[ASSETS.md](ASSETS.md).

---

## 11. Âm thanh (`music[]` + `audio`)

- `music[]`: nhiều track, mỗi track `{ path, volume (0–1) }`. Playlist **lặp** để phủ hết video.
- `audio.crossfade` (0–30s): nối các track bằng acrossfade.
- `audio.fade_in` / `audio.fade_out` (0–30s): fade toàn video.
- `audio.automation[]`: envelope âm lượng master `{ at, volume (0–2) }`, phải **tăng dần theo `at`** (ramp tuyến tính giữa các điểm).
- `audio.voiceover`: `{ path, start, volume (0–2), ducking }` — lồng tiếng, có thể **ducking** (nén sidechain hạ nhạc dưới giọng).

Nhạc/voiceover phải tồn tại (validate kiểm tra). Thời lượng track được đo qua ffprobe.

---

## 12. Xử lý an toàn & tự động

- **Image cache:** ảnh quá lớn được thu nhỏ vào `temp/image-cache` trước render (không sửa ảnh gốc). Cạnh dài mặc định **2560px** — chỉnh bằng env `IMAGE_CACHE_MAX_EDGE`, đặt `0` để tắt.
- **Face-safe framing:** với layer ảnh `layer_scene`, layer không phải nền dùng `fit:"cover"` mà tỉ lệ crop-loss quá cao sẽ bị đổi sang `contain`. Ngưỡng env `FACE_SAFE_MAX_CROP_LOSS` (mặc định **0.18**), đặt `0` để tắt. **Chỉ áp dụng khi layer có `faceBox`** (do `analyzePhotos.mjs` phát hiện mặt/da thật) — ảnh không có mặt (phong cảnh, đồ vật, decor...) giữ nguyên `cover` + motion đã khai báo, vì không có gì để bảo vệ.
- **Preflight:** trước khi render báo cáo số slide/ảnh/nhạc, thời lượng ước tính, media không đọc được, nguy cơ tràn chữ, và lỗi layer vượt khung.
- Auto-route ảnh dọc → `portrait_blur_background`; auto-route theo tỉ lệ khung (crop-loss > 0.3) khi khung khác 16:9.

---

## 13. Ràng buộc (validate sẽ chặn nếu vi phạm)

- Slide `duration`: **2–30 giây**.
- Transition `duration`: **0–2s** và **< duration của slide**.
- Caption: `start + duration ≤ duration` của slide.
- Layer: `start + duration ≤ duration` của slide; `width/height > 0`.
- `memory_wall`: **1–5** ảnh · effect nhiều ảnh khác: **≥2** ảnh · `video_background`: cần `background` · `layer_scene`: **≥1** layer.
- `id` slide phải **duy nhất**; mọi file ảnh/nhạc/LUT/font/overlay tham chiếu phải **tồn tại**.
- `audio.automation` phải tăng dần theo `at`; overlay `end` (nếu có) phải > `start`.

---

## 14. Sử dụng (CLI)

```bash
# 1) Sinh timeline tự động từ thư mục ảnh
npm run gen -- [cờ]

# 2) Render timeline thành MP4
npm run render -- --timeline timeline/timeline.json      # thêm --dry-run để in lệnh không render

# 3) Kiểm tra type
npm run typecheck
```

**Cờ của `npm run gen`** (`src/generateTimeline.ts`):

| Cờ | Mặc định | Ý nghĩa |
|---|---|---|
| `--input <dir>` | `input` | thư mục ảnh |
| `--out <path>` | `timeline/timeline.json` | file timeline xuất ra |
| `--count N` | (tất cả) | chỉ lấy N ảnh đầu |
| `--duration S` | `4` | thời lượng mỗi slide |
| `--music <path>` | `music/wedding.mp3` | nhạc nền |
| `--volume V` | `0.8` | âm lượng nhạc |
| `--transition T` | `crossfade` | `none` \| tên transition bất kỳ \| `mix` (xoay nhiều kiểu) |
| `--title / --ending` | — | caption slide đầu / slide cuối |
| `--logo / --particles` | — | overlay logo (góc dưới phải) / loop hạt (screen blend) |
| `--vignette` | tắt | bật vignette global |
| `--curves <preset>` | — | preset curves cho grade global |
| `--look <bundle>` | — | gói grade sẵn: `cinematic` · `film` · `dreamy` · `clean` |

Generator tự chọn framing theo hướng ảnh (dọc→blur-bg, vuông→still, ngang→xoay vòng 8 kiểu zoom/pan/kenburns)
và tự gán **font cưới** theo role nếu có trong `fonts/` (title→GreatVibes, subtitle→PlayfairDisplay, caption→BeVietnamPro; fallback Arial).

---

## 15. Bộ sinh timeline "AI Director" (scripts nâng cao)

Ngoài generator theo orientation, có pipeline sinh timeline giàu cảm xúc, thích ứng theo ảnh + nhạc + câu chuyện
(tất cả không dùng ML, chỉ ffmpeg + node):

- `schema/timeline.schema.json` — JSON Schema phản chiếu đúng validate (dùng cho AI viết JSON).
- `layouts/library.json` — thư viện layout + design token (theme, font, type scale, motion, pacing).
- `docs/generation-guide.md` — brief cho "Director": beat sheet → gán layout → điền slot → pace theo nhạc → emit.
- `scripts/analyzeMusic.mjs` → `analysis/music/<name>.json` (RMS energy, đoạn calm/normal/build, BPM thô).
- `scripts/analyzePhotos.mjs` → `analysis/photos.json` (orientation, độ nét, điểm chất lượng, focal point).
- `scripts/generateStoryClipV2.mjs` — Director v2: chọn ảnh hero theo chất lượng, gắn focal point, pace theo năng lượng bài hát.
- `scripts/fitTextInTimeline.mjs` — đo bề rộng glyph thật để wrap/thu chữ vừa khung (chống tràn deterministically).
- `scripts/qaClip.mjs` → `analysis/qa/<name>.json` — QA sau render: lấy 1 frame/scene, cờ too_dark/too_bright/flat.
- `scripts/runProject.mjs` — orchestrator DUY NHẤT: analyze → plan → build → render → QA → deliver,
  cho cả 3 tier, mỗi job một thư mục riêng. (`buildClip.mjs` — driver cũ chạy ở root — **đã xoá 2026-07-11**.)
- `scripts/generateLightLeaks.mjs` — tái tạo 3 asset light-leak procedural trong `overlays/` (chạy lại khi cần đổi màu/độ mạnh).

```bash
npm run project:create -- --id my-video --input input --music "music/track.mp3"
npm run lite -- --project projects/my-video     # hoặc: template | premium
```

Pipeline này là **tier Lite** trong [PIPELINE-V1-VA-LITE.md](PIPELINE-V1-VA-LITE.md) — rule-based,
gần như không tốn AI. Tier v1 Premium (AI đóng vai đạo diễn, khách chọn story) mô tả trong cùng file đó.

---

## 16. Yêu cầu môi trường

- **FFmpeg** (ffmpeg + ffprobe). Thứ tự tìm: env `FFMPEG_PATH` → `ffmpeg-static` (devDependency đã cài) → `ffmpeg` trên PATH.
- **Font:** thư mục `fonts/` có sẵn font cưới Google (GreatVibes, DancingScript, Italianno, WindSong, MeaCulpa, Pacifico, Lobster, Charm, PlayfairDisplay, BeVietnamPro). Cho chữ tiếng Việt dài, **BeVietnamPro** và **PlayfairDisplay** là an toàn dấu nhất. Font mặc định caption: env `CAPTION_FONT` (fallback `C:/Windows/Fonts/arial.ttf`).
- **Biến môi trường:** `FFMPEG_PATH`, `IMAGE_CACHE_MAX_EDGE` (mặc định 2560, 0=tắt), `FACE_SAFE_MAX_CROP_LOSS` (mặc định 0.18, 0=tắt), `CAPTION_FONT`.

---

## 17. Giới hạn hiện tại (chưa hỗ trợ)

- Không cho phép filtergraph FFmpeg tùy ý — chỉ dùng các preset ở trên.
- Không có keyframe tùy ý theo từng object; không có crop-rectangle thủ công trong collage/film-roll.
- Không có mask-shape editor ngoài các transition preset + overlay PNG.
- Không có cảnh 3D thật / parallax theo depth-map. (Light-leak procedural **đã có** — xem §10.)
- **Không có face detection thật** — face-safe hiện dựa trên tỉ lệ (đổi cover→contain), không định vị mắt/mặt.
- Không auto beat-sync (phát hiện beat là non-goal); phát hiện tràn chữ là heuristic (chỉ QA hình mới chắc chắn tuyệt đối).
- `video_background` dành cho file video, không phải ảnh tĩnh.

---

## 18. Tham chiếu chéo

- [ENGINE_CAPABILITIES.md](ENGINE_CAPABILITIES.md) — hợp đồng timeline (tiếng Anh) dành cho AI viết JSON.
- [ENGINE-ARCHITECTURE.md](ENGINE-ARCHITECTURE.md) — module, CLI, exit code, log, gotcha FFmpeg.
- [generation-guide.md](generation-guide.md) — brief cho AI Director (beat sheet → layout → emit).
- [PIPELINE-V1-VA-LITE.md](PIPELINE-V1-VA-LITE.md) — pipeline sản phẩm 2 tier (Lite/Premium).
- [ASSETS.md](ASSETS.md) — danh mục font/overlay/background/frame + license.
- `schema/timeline.schema.json` — schema máy đọc.
- Source of truth: `src/types.ts` (enum/field), `src/validateTimeline.ts` (ràng buộc), `src/quality.ts` (preset chất lượng).
