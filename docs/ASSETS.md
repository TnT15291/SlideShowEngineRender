# Danh mục asset local

Toàn bộ font, overlay, background, frame đóng gói sẵn trong repo. Đường dẫn trong
timeline tính tương đối từ gốc project.

## Catalog cho AI Director

Không cho AI Director đọc trực tiếp toàn bộ cây thư mục asset hoặc tự bịa path. Khi thêm/xóa
font, overlay, background, frame, chạy:

```bash
npm run analyze:assets
```

Lệnh này tạo hai file:

- `analysis/assets_catalog.full.json` — bản đầy đủ cho code: `id`, `path`, license/source hint,
  kích thước/thời lượng nếu `ffprobe` đọc được.
- `analysis/assets_catalog.ai.json` — bản gọn cho prompt: `id`, `label`, `summary`, `mood`,
  `bestFor`, `roles`, `variant`. AI Director chỉ chọn `id`, không chọn path.

Luồng đúng:

```text
asset local -> analyzeAssets.mjs -> assets_catalog.ai.json
AI Director chọn assetId -> timeline generator map assetId bằng assets_catalog.full.json
engine validate path thật -> render
```

Tên asset nên ngắn nhưng có nghĩa, ví dụ `bg_soft_gold_bokeh_01`,
`ov_light_leak_warm`, `font_bevietnampro`, `frame_floral_corner_soft_1920x1080`.

## Font cưới (`fonts/`)

18 font Google (10 gốc + 8 thêm 2026-07-26 theo khảo sát trend cưới 2026), **đã kiểm
tra render dấu tiếng Việt bằng ffmpeg drawtext** (câu mẫu nhiều dấu: "Nguyễn Thị Yến
Nhi & Đặng Quốc Việt — Thương yêu, trọn vẹn."; sampler gốc: [fonts-sampler.png](fonts-sampler.png)).

**Text-safe (10 font — hợp cho caption/quote tiếng Việt dài, dễ đọc ở size nhỏ):**

| File | Kiểu | Dùng cho |
|---|---|---|
| `BeVietnamPro-Regular.ttf` | sans hiện đại | **caption tiếng Việt dài** (body, mọi theme) |
| `PlayfairDisplay.ttf` | serif sang trọng cổ điển | heading — `editorial_bold`, `teal_orange_editorial` |
| `CormorantGaramond-Regular.ttf` | serif mảnh, lãng mạn | heading — `white_weddings` |
| `YesevaOne-Regular.ttf` | serif display đậm, kịch tính | heading — `dark_film` |
| `Fraunces-Regular.ttf` | serif ấm, soft-contrast, hoài niệm | heading — `warm_film`, `super8_nostalgia` |
| `Montserrat-Regular.ttf` | sans hình học hiện đại | heading — `modern_teal`; cặp kinh điển với Playfair Display |
| `JosefinSans-Regular.ttf` | sans tối giản, thanh mảnh | script_accent (vai "clean sans companion") — `editorial_bold`, `modern_teal` |
| `AlexBrush-Regular.ttf` | brush script biểu cảm | script_accent — `dark_film`, `teal_orange_editorial` |
| `Allura-Regular.ttf` | script mềm, tinh tế | script_accent — `white_weddings`, `warm_film` |
| `Merienda-Regular.ttf` | handwriting tròn, casual | script_accent — `super8_nostalgia` |

**Script/display (8 font — CŨNG đủ dấu tiếng Việt, nhưng chỉ hợp chữ ngắn và size lớn):**

| File | Kiểu | Dùng cho |
|---|---|---|
| `GreatVibes-Regular.ttf` | thư pháp cổ điển | tên ngắn (nên size ~120–140) |
| `DancingScript.ttf` | script mềm | tên ngắn |
| `Italianno-Regular.ttf` | script mảnh | "the wedding of", tên ngắn |
| `WindSong-Medium.ttf` | script trang trí | accent ngắn |
| `MeaCulpa-Regular.ttf` | script mảnh | accent ngắn |
| `Pacifico-Regular.ttf` | script tròn | accent vui tươi, chữ ngắn |
| `Lobster-Regular.ttf` | script đậm | tiêu đề nổi, ngắn |
| `Charm-Regular.ttf` | script nhẹ | phụ đề ngắn |

> **ĐÍNH CHÍNH (2026-07-30).** Bảng này trước đây ghi 8 font trên là "Latin-only, thiếu
> glyph tiếng Việt". Sai. Kiểm tra lại bằng cách quét trực tiếp bảng `cmap` của cả 18 file
> trong `fonts/` với trọn bộ 134 ký tự tiếng Việt dựng sẵn: **cả 18 font đều phủ đủ**, và
> render `ffmpeg drawtext` thật ("Nguyễn Đệ ượt ữỡ ẵặỹ Ơn") xác nhận GreatVibes/Italianno/
> DancingScript/MeaCulpa hiện đúng từng dấu. Nhầm lẫn cũ đến từ việc tra trường `subsets`
> của Google Fonts metadata API — đó là *cách Google đóng gói subset file*, không phải
> vùng phủ glyph của bản TTF đầy đủ trong repo này.
>
> Hệ quả thật của luật sai đó: `cap()` trong `scripts/applyStoryTemplate.mjs` bị ép dùng
> face `body` cho **mọi** caption của **mọi** recipe, nên toàn bộ caption hiện ra bằng một
> font sans UI trông y như Arial. Nay caption lấy face `heading` của theme.
>
> Luật còn lại là **luật đọc được, không phải luật glyph**: 8 font script ở trên rất mảnh
> và nhiều nét bay — chỉ dùng cho vài chữ cỡ lớn, đừng dùng cho cả câu.
>
> Điều kiện duy nhất còn hiệu lực: chữ phải ở dạng **NFC (dựng sẵn)**. Chuỗi NFD (dấu tách
> rời) không nằm trong vùng phủ và sẽ mất dấu. Copy trong `story-templates/*.json` hiện là NFC.
>
> Bộ font theo từng theme (`heading`/`script_accent`/`body`) khai ở
> `layouts/library.json` → `designTokens.themes.<themeId>.fonts` — đây là nguồn thật
> `resolveFont()` đọc khi render (`scripts/lib/templateTheme.mjs`); field
> `defaults.fonts` trong mỗi `story-templates/*.json` chỉ là bản phản chiếu cho người
> đọc, theme mới thắng khi khác nhau.

**Bug đã sửa (2026-07-26):** caption sinh từ `captionPattern` (đa số cảnh không phải
`layer_scene` — memory_wall, mask_reveal, film_roll_up, spotlight_focus, double_exposure…)
trước đây **không có `font`** trong object trả về của `cap()`
(`scripts/applyStoryTemplate.mjs`), nên luôn rơi về `DEFAULT_FONT` của
`compileTimeline.ts` = `C:/Windows/Fonts/arial.ttf` — Arial mặc định Windows, bất kể
theme. Đã sửa: `cap()` giờ set `font: resolveFont("body")` (BeVietnamPro của theme).

Font mặc định caption khi vẫn không khai `font` ở đâu đó: env `CAPTION_FONT`, fallback
`C:/Windows/Fonts/arial.ttf`. (Đây là fallback cấp thấp của `compileTimeline.ts`; pipeline
recipe-tier ở trên không còn chạm tới nó nữa.) Generator độc lập `src/generateTimeline.ts`
(`npm run gen`, KHÔNG dùng recipe) tự gán theo role riêng (title→GreatVibes 135,
subtitle→Playfair, caption→BeVietnamPro) — không liên quan tới hệ theme trên.

## Overlay đóng gói (`overlays/`)

Dùng làm `overlays[]` phủ toàn video.

| File | Kiểu | Cách dùng |
|---|---|---|
| `light_leak_warm.mp4` | quầng vàng ấm góc phải trên | `{ "variant": "warm" }` — hợp look dark-film/hoài niệm |
| `light_leak_soft.mp4` | dải trắng nhẹ cạnh trên | `{ "variant": "soft" }` — theme cream sáng |
| `light_leak_sunset.mp4` | cam + hồng tím quét từ trái | `{ "variant": "sunset" }` — beat hoàng hôn |
| `particles.mp4` | hạt sáng nền đen | `{ "path": "overlays/particles.mp4", "blend": "screen" }` |

**Light leak sinh procedural** bằng `node scripts/generateLightLeaks.mjs` — quầng
Gaussian trôi theo sin/cos chu kỳ đúng 10s nên **loop liền mạch**, không dùng footage
ngoài nên không vướng bản quyền. Khai bằng `variant` (thay cho `path`) tự đặt
`blend: "screen"`, `opacity: 0.6`; khuyến nghị opacity 0.4–0.7. Chi tiết:
NANG-LUC-ENGINE.md §10.

## Asset stock tải về (`assets/`)

Dùng được ngay làm overlay fullscreen hoặc (backgrounds) nguồn cho `video_background`.
**Giấy phép**: xem `assets/licenses/*.md` — vài file 720p ở Mixkit Restricted License
(ghi nhãn personal use); kiểm tra trang nguồn trước khi phát hành thương mại.

### Bokeh / light-leak (`assets/overlays/`)

| File | Ghi chú license |
|---|---|
| `mixkit_natural_light_leaks_bokeh_720.mp4` | Mixkit Restricted (personal use) |
| `mixkit_sunlight_flare_overlay_720.mp4` | Mixkit Restricted (personal use) |
| `mixkit_bokeh_lights_black_720.mp4` | Mixkit Restricted (personal use) |
| `cutestock_golden_bokeh_overlay_hd.mp4` | Free, xin credit Cute Stock Footage |

Nền đen → dùng `blend: "screen"`.

### Background lãng mạn (`assets/backgrounds/`)

| File | Hợp cho | License |
|---|---|---|
| `mixkit_yellow_pink_bokeh_background_1080.mp4` | nền title intro/outro, overlay opacity thấp | Mixkit Free (thương mại OK) |
| `mixkit_wedding_flower_arrangement_calla_lilies_1080.mp4` | intro, chương, title card | Mixkit Free |
| `mixkit_girl_smells_bouquet_romantic_1080.mp4` | chuyển cảnh lãng mạn | Mixkit Free |
| `mixkit_blurred_bokeh_effect_720.mp4` | không khí nhẹ | Mixkit Restricted |
| `mixkit_waiting_with_flowers_romantic_720.mp4` | interlude tự sự | Mixkit Restricted |

Ví dụ overlay bokeh nền:

```json
"overlays": [
  { "path": "assets/backgrounds/mixkit_yellow_pink_bokeh_background_1080.mp4",
    "position": "fullscreen", "opacity": 0.18, "margin": 0, "blend": "screen", "start": 0 }
]
```

Để làm nền title card thật, dùng slide `effect: "video_background"` với `background`
trỏ tới file này (thay vì overlay).

### Khung trang trí (`assets/frames/`)

| File | Ghi chú |
|---|---|
| `floral_corner_soft_1920x1080.png` | khung hoa PNG trong suốt 1920×1080 — overlay `blend: "alpha"`, `position: "fullscreen"` |
| `source/openclipart_floral_*.png` | ảnh gốc public-domain (OpenClipart) để chế thêm khung |

## Theme mẫu (`assets/white-weddings-theme/`)

`media/` — asset reverse-engineer từ theme Canva "White Weddings" (pptx/svg/mp4) dùng
khi dựng layout kiểu save-the-date cream. Xem `layouts/library.json` cho token thiết kế.
