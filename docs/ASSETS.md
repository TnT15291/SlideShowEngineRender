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

10 font Google, **đã kiểm tra render dấu tiếng Việt** (sampler: [fonts-sampler.png](fonts-sampler.png)).

| File | Kiểu | Dùng cho |
|---|---|---|
| `GreatVibes-Regular.ttf` | thư pháp cổ điển | title (nên size ~120–140) |
| `DancingScript.ttf` | script mềm | title/subtitle phụ |
| `Italianno-Regular.ttf` | script mảnh | tên romanized, "the wedding of" |
| `WindSong-Medium.ttf` | script trang trí | accent Latin |
| `MeaCulpa-Regular.ttf` | script mảnh | accent Latin |
| `Pacifico-Regular.ttf` | script tròn | accent vui tươi |
| `Lobster-Regular.ttf` | script đậm | tiêu đề nổi |
| `Charm-Regular.ttf` | script nhẹ | phụ đề |
| `PlayfairDisplay.ttf` | serif sang trọng | subtitle, năm, tên |
| `BeVietnamPro-Regular.ttf` | sans hiện đại | **caption tiếng Việt dài** |

> Chữ tiếng Việt có dấu → chỉ dùng **BeVietnamPro** (body) hoặc **PlayfairDisplay**
> (heading). Các font script còn lại là Latin-only: dùng cho `the`, `save the date`,
> tên romanized — **không** dùng cho câu tiếng Việt có dấu (thiếu glyph → hỏng dấu).

Font mặc định caption khi không khai `font`: env `CAPTION_FONT`, fallback
`C:/Windows/Fonts/arial.ttf`. Generator tự gán theo role khi file tồn tại
(title→GreatVibes 135, subtitle→Playfair, caption→BeVietnamPro).

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
