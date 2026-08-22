# Kế hoạch: Video phóng sự phong trào Toàn dân bảo vệ an ninh Tổ quốc tại xã Lao Bảo

Video 16:9, **thời lượng linh hoạt theo kịch bản đã duyệt**, dựng từ **ảnh + clip quay thật**, có
**giọng đọc AI tiếng Việt** bám kịch bản và **nhạc nền** chìm dưới giọng đọc. Kịch bản hiện tại có
2.588 chữ, dự kiến thành phẩm khoảng **17–19 phút**; thời lượng chính xác lấy từ `narration.wav`.

> **Vì sao file này nằm ở thư mục gốc chứ không phải `docs/`:** mọi script và `npm run`
> được nhắc ở đây **nay đã tồn tại**, nên rào cản ban đầu của `scripts/checkDocs.mjs` không
> còn. Rào cản còn lại là **liên kết tương đối**: `checkDocs.mjs` phân giải link theo thư mục
> chứa file, nên chuyển vào `docs/` sẽ làm hỏng toàn bộ `[x.ts](src/x.ts)` — phải đổi thành
> `../src/...` cùng lúc với việc chuyển. Đây là việc dọn dẹp, làm sau khi phim đã ra.

---

## Tình trạng (cập nhật 2026-08-23)

Phần **code** của Phase 1–3 đã dựng xong và có test chạy thật trong `npm run test:unit`
(`test/narrated-project.test.mjs`: 11 test, trong đó có một lần `--dry-run` thật xuyên qua
engine và một lần cắt clip dọc thật bằng ffmpeg). Phần **nội dung và tư liệu** thì chưa —
và đó mới là đường găng.

| Thành phần | Trạng thái |
|---|---|
| `npm run narration:import` — kịch bản `.md` → `script.json` | ✅ có; từ chối ghi đè `script.json` đã có (dùng `--force` nếu thật sự muốn làm lại) |
| `npm run footage:prepare` — cắt + chuẩn hoá subclip | ✅ có; tự `pad` clip dọc, `-an`, và **tự kiểm tra lại** file vừa xuất bằng ffprobe |
| `npm run narration:synthesize` — TTS + ghép | ✅ có; adapter VieNeu (bridge Python) + FPT.AI, cache theo hash, loudnorm hai lượt |
| `npm run narration:timeline` — dựng timeline | ✅ có; đủ 9 luật dựng + cổng chặn tư liệu thiếu |
| `npm run narration:srt` — xuất phụ đề | ✅ có; tự cắt beat dài thành cue đọc được |
| Kịch bản đã duyệt nội dung/số liệu | ❌ vẫn `reviewStatus: "needs-content-approval"` (đo 23-08) — bản phim hiện có dựng bằng `--allow-unapproved`, **chưa giao được** |
| Gán tư liệu cho từng beat | ✅ **53/53 beat đã có hình**: 81 ảnh + 18 clip. Từ 19-08 việc này do `narration:assign` / `narration:propose` + `narration:apply` làm, không còn đặt tay — xem [PLAN-NARRATED-PRODUCT.md](PLAN-NARRATED-PRODUCT.md) §N2 |
| Kho clip đã kiểm kê | ✅ `review/footage-inventory.md` |
| Nhạc nền có giấy phép | ❌ đã **chọn** nhưng chưa rõ giấy phép; file nằm ở `input/music/` nên `assertLicensedMusic` (vốn chỉ soi `music/`) **không thấy** |

**Phim đã có, chưa giao.** `output/antt-lao-bao-2026.mp4` — **10:46**, 1920×1080, h264+aac, 640 MB
(render 2026-08-17). Timeline hiện tại `timeline/antt-lao-bao.json` **mới hơn bản đã render**:
106 slide / 718s so với 97 slide của bản dựng ra file trên. `output/archive/` còn giữ **8 bản render
cũ, 3,7 GB** — một mình dự án này chiếm ~4,4 GB trong 50 GB của `projects/`.

**Cổng chặn:** cả `narration:synthesize` lẫn `narration:timeline` đều từ chối chạy khi
`script.reviewStatus !== "approved"`. Cờ `--allow-unapproved` chỉ để thử giọng, không để
dựng bản giao. Builder cũng dừng hẳn nếu còn beat chưa gán hình.

---

## 0. Kết luận khảo sát engine (đã kiểm chứng trong code, không phải phỏng đoán)

### Đã có sẵn — dùng ngay, không cần sửa engine

| Năng lực | Ở đâu | Ghi chú |
|---|---|---|
| **Lồng tiếng + ducking** | `audio.voiceover {path,start,volume,ducking}` — [schema/timeline.schema.json:57-66](schema/timeline.schema.json#L57-L66) | Mix ở [buildAudioMuxCommand.ts:79-95](src/buildAudioMuxCommand.ts#L79-L95): `sidechaincompress=threshold=0.03:ratio=10:attack=100:release=500` tự hạ nhạc dưới giọng. Validate bắt buộc file phải tồn tại ([validateTimeline.ts:273-277](src/validateTimeline.ts#L273-L277)). |
| **Phát clip video toàn khung** | `effect: "video_background"` + `slide.background` | Build tại [buildFfmpegCommand.ts:77-91](src/buildFfmpegCommand.ts#L77-L91): `-stream_loop -1 -i clip -t <duration>`, rồi `scale=cover,crop,setsar=1,fps,format=yuv420p`. **Có** áp được color grade, letterbox và captions lên clip. |
| **Nhạc nền playlist** | `music[]` + `audio.{fade_in,fade_out,crossfade,automation}` | Lặp/crossfade để phủ hết độ dài video, có envelope âm lượng theo mốc thời gian. |
| **Overlay video (logo, cờ, hạt sáng)** | `overlays[]` nhận `.mp4/.mov/.webm`, blend `screen`/`add`, có `start`/`end` | [buildFinalVideoCommand.ts:85-120](src/buildFinalVideoCommand.ts#L85-L120) |
| **Chữ tiếng Việt có dấu** | `fonts/BeVietnamPro-Regular.ttf`, `Montserrat`, `JosefinSans` | `analyzeAssets.mjs` gán nhãn BeVietnamPro = "Clean Vietnamese body text"; các font script bị đánh dấu `low_for_long_text` — **không dùng cho lời bình**. |
| **Chèn chữ** | `captions[]` (drawtext, có `outline` + `shadow`) hoặc `layer_scene` + layer `text` (có `wrap: true` tự xuống dòng) | Chữ trên nền clip nên có `outline` để đọc được. |
| **Cắt cảnh 59 kiểu** | `transition.type` | Tối đa 2s và phải < độ dài slide. `transition` của slide là chuyển **sang slide sau** ([buildFinalVideoCommand.ts:38-53](src/buildFinalVideoCommand.ts#L38-L53)). |
| **Catalog clip** | `npm run analyze:assets` | `analyzeAssets.mjs` đã nhận `.mp4/.mov/.webm/.m4v`, đo `duration` bằng ffprobe, gán `type: "video_background"`. |
| **Bản dọc 9:16 + teaser** | `npm run social` | `retargetTimeline()` để nguyên slide `video_background` → clip tự cover-crop về 1080×1920. |

### Chưa có — phải làm hoặc phải đi đường vòng

| Thiếu | Hệ quả | Cách xử lý ở v1 |
|---|---|---|
| ~~**Không có bất kỳ tích hợp TTS nào** trong repo~~ | `audio.voiceover` chỉ là một đường dẫn file; không ai sinh ra file đó | ✅ **đã làm**: `scripts/synthesizeNarration.mjs` + `scripts/lib/tts/` |
| **Chỉ được MỘT `voiceover`** cho cả timeline | Không thể rải nhiều đoạn đọc theo từng cảnh | Ghép **một** file WAV liền mạch (câu + khoảng lặng) từ các câu rời, kèm `narration.json` giữ mốc thời gian |
| **`video_background` không có điểm vào (in-point)** | Luôn phát từ giây 0 của file nguồn | **Phase 1**: cắt sẵn từng subclip đúng đoạn cần dùng |
| **`-stream_loop -1`**: clip ngắn hơn slide sẽ **lặp lại** | Lộ liễu nếu clip 3s mà slide 8s | Quy tắc: `độ dài subclip ≥ độ dài slide`; builder tự kiểm tra |
| **Clip không giữ tiếng hiện trường** | Không có tiếng họp dân, giao thông hoặc hoạt động tại cơ sở | **Đã chốt: bỏ tiếng hiện trường.** Clip vào phim câm hoàn toàn (`-an`); phần tiếng chỉ gồm giọng đọc + nhạc nền. Hết là việc phải làm — và đây cũng là hạng mục engine đắt nhất, nay không phải đụng tới. |
| **`layer_scene` chỉ có layer `image`/`rect`/`text`** | Clip không thể nằm trong khung/thẻ cạnh ảnh, không thể chia đôi màn hình | Clip luôn toàn khung ở v1. Muốn ghép → Phase 7 |
| **Slide bị chặn cứng 2–30 giây** | Một câu dẫn dài 40s không thể là một slide | Builder tự chia beat dài thành nhiều slide |
| Ba tier `template`/`lite`/`premium` đều là **công thức đám cưới**, chỉ ăn ảnh | Không dùng được | Đi đường **timeline tự soạn** → `npm run render` |

### Bốn quyết định kiến trúc

1. **Không dùng pipeline cưới.** `story-templates/` là 25 recipe đám cưới, solver phân bổ **ảnh** chứ không biết clip, từ vựng lời thoại là từ vựng cưới. Ta soạn timeline bằng một builder riêng rồi gọi thẳng `npm run render -- --timeline ...`.
2. **Lời đọc là xương sống thời lượng, không phải nhạc.** Ngược với pipeline cưới (`retimeTimelineToMusic.mjs` — **không dùng ở dự án này**). Độ dài mỗi cảnh = độ dài câu đọc tương ứng + đệm.
3. **Không sửa engine ở v1.** Mọi thứ v1 cần đều đã có. Việc sửa engine (layer video, in-point cho clip) gom vào Phase 7 và chỉ làm nếu bản v1 cho thấy thực sự thiếu.
4. **Phim câm + giọng đọc + nhạc.** Đã chốt bỏ tiếng hiện trường, nên đường tiếng chỉ có hai lớp: `voice/narration.wav` và `music[]`. Không cần đụng vào kiến trúc âm thanh của engine ở bất kỳ phase nào.

### Hệ quả của một phim dài khoảng 17–19 phút

Đây là phim dài, nên vài thứ đổi chất chứ không chỉ đổi lượng:

- **Số cảnh: khoảng 110–180 slide** nếu mỗi hình/clip giữ 6–10 giây. Engine chịu được — [renderFinal.ts:150-215](src/renderFinal.ts#L150-L215) tự chia thành các mẻ `xfade` 16 slide rồi nối các mẻ lại (`MAX_XFADE_INPUTS = 16`), tránh mở hàng trăm decoder cùng lúc.
- **Đổi lại, phim bị encode chồng 2 lớp** (mẻ → nối mẻ) trước khi mux nhạc. Vì vậy dùng `quality: "high"` trở lên; đừng render `share` rồi mong nét.
- **Cần đủ tư liệu phủ 17–19 phút.** Muốn giữ mốc "≥1/3 là clip" thì cần khoảng **6 phút clip dùng được** sau khi loại đoạn rung, lệch sáng và trùng bối cảnh. **Kiểm kê kho clip trước khi viết dòng code nào** — thiếu tư liệu thì phải rút hoặc viết lại đoạn tương ứng.
- **Nhạc nền: một bài là không đủ.** Dùng playlist 4–5 bài cùng tông, `audio.crossfade: 2.0`, đổi bài đúng chỗ chuyển phần.
- **Thời gian render dài** (hàng giờ ở `high`). Vì thế `--dry-run` ở Phase 5 không phải thủ tục cho có — một lỗi validate phát hiện muộn là mất cả buổi.
- **Nhịp phim phải có điểm nghỉ.** Chèn card chuyển phần (`layer_scene`, 3–4s, chỉ có chữ + nhạc lên) giữa 6 phần lớn — vừa cho người xem thở, vừa cho người dựng chỗ nối nhạc.

---

## 1. Cấu trúc thư mục dự án

```
projects/antt-lao-bao-2026/
  project.json              # tạo bằng npm run project:create
  script/
    script.md               # kịch bản người đọc được, để duyệt nội dung
    script.json             # kịch bản máy đọc được (nguồn sự thật duy nhất)
  photos/                   # ảnh tư liệu đã chọn
  footage/
    raw/                    # clip gốc từ máy quay/điện thoại
    clips/                  # subclip đã chuẩn hoá (Phase 1 sinh ra)
    footage.json            # catalog: file, duration, độ phân giải, mô tả
  voice/
    cache/                  # cache theo hash câu — không gọi lại API
    lines/                  # từng câu .wav
    narration.wav           # file lồng tiếng liền mạch duy nhất
    narration.json          # mốc thời gian từng câu
  music/                    # nhạc nền đã có bản quyền + file giấy phép
  timeline/antt-lao-bao.json
  output/antt-lao-bao-2026.mp4
  logs/  temp/  analysis/
```

Tạo bằng:

```powershell
npm run project:create -- --id antt-lao-bao-2026 --name "Toàn dân bảo vệ an ninh Tổ quốc - Lao Bảo 2026" --quality high
```

---

## 2. Các giai đoạn

### Phase 0 — Chốt nội dung và thông số (không code)

- [ ] Chốt **đơn vị phát hành**, đối tượng xem, kênh phát (hội nghị / màn LED / Facebook / YouTube).
- [ ] **Ước tính thời lượng từ kịch bản**, không đặt trần cứng: `số chữ / tốc độ đọc thử + thời gian ngắt nghỉ + mở/kết`. Dùng khoảng 2,3–2,8 chữ/giây để dự trù. Với 2.588 chữ hiện tại, dự kiến **17–19 phút**; lấy độ dài thực tế của `voice/narration.wav` làm nguồn sự thật sau khi tổng hợp.
- [ ] Chốt **thông số kỹ thuật**: 1920×1080, 30 fps, `quality: "high"`. Nếu phát trên màn LED lớn thì cân nhắc `"master"`.
- [ ] Biên tập lại `script/script.md` theo bố cục 6 phần; không ép tỉ lệ thời lượng nếu làm mất ý:
  1. **Mở đầu** — hành trình 21 năm và thông điệp “an ninh từ Nhân dân”.
  2. **Địa bàn Lao Bảo** — hợp nhất đơn vị hành chính, dân số, đặc thù biên giới và nền tảng phong trào.
  3. **Mô hình tự quản tiêu biểu** — tổ liên gia, dân phòng, hòa giải, camera an ninh và mô hình cảm hóa người sử dụng trái phép chất ma túy.
  4. **Tuyên truyền và kết quả** — hội nghị, trường học, khu dân cư, cơ quan, doanh nghiệp và mục tiêu xã không ma túy.
  5. **Sức mạnh của các đoàn thể** — Mặt trận Tổ quốc, Hội Phụ nữ, Hội Cựu Công an nhân dân, trường học và Hội Nông dân.
  6. **Thành quả và kết** — điển hình, khen thưởng, niềm tin của Nhân dân và định hướng tương lai.
- [ ] **Làm sạch lời bình trước khi TTS**: sửa câu cụt, từ nhận dạng sai và câu quá dài; ví dụ đoạn kết bằng “công tác xây dựng” đang bị đứt ý. Không tự suy diễn nội dung còn thiếu — gửi người phụ trách nội dung xác nhận.
- [ ] **Lập bảng kiểm chứng số liệu/tên riêng** và có người chịu trách nhiệm duyệt: 21 năm; 83,4 km²; 23.890 người; khoảng 3.100 người dân tộc thiểu số; 12 thôn; 45 chi, đảng bộ; 710 đảng viên; hơn 20 mô hình; các số liệu tuyên truyền và tỷ lệ đăng ký đạt chuẩn. Đối chiếu cả mốc “năm 2026” và mục tiêu 2030 với văn bản chính thức.
- [ ] **Kiểm kê kho tư liệu có sẵn TRƯỚC khi chốt kịch bản.** Clip đã có rồi, nên đây là bài toán ngược: đếm xem có bao nhiêu phút clip dùng được và bao nhiêu ảnh, rồi viết kịch bản vừa với tư liệu. Giữ kịch bản 17–19 phút cho một kho chỉ có 4 phút hình dùng được sẽ dẫn tới lặp hình hoặc phải cắt lại từ đầu.
- [ ] Với **mỗi câu**, ghi rõ hình đi kèm: ảnh nào, hoặc **đoạn nào trong clip nào** (tên file + mốc giờ). Câu nào chưa có hình thì đánh dấu — hoặc sửa câu, hoặc dùng ảnh thay.
- [ ] **Duyệt nội dung trước khi làm tiếp.** Video tuyên truyền sai số liệu/sai tên đơn vị là phải làm lại toàn bộ, mà đây là bước rẻ nhất để sửa.

**Nghiệm thu:** `script.md` không còn câu cụt/lỗi nhận dạng; bảng số liệu và tên riêng đã được ký duyệt; mỗi beat đã có hình dự kiến; tổng hình dự kiến đủ phủ toàn bộ kịch bản.

---

### Phase 1 — Kiểm kê và chuẩn hoá tư liệu

> **Clip đã có sẵn — không phải đi quay.** Nên phase này là *chọn và cắt*, không phải *sản xuất*. Việc quay không nằm trên đường găng, đổi lại chất lượng phim bị chặn trên bởi chất lượng kho clip hiện có: chỗ nào tư liệu yếu thì phải né bằng kịch bản chứ không quay bù được.

**Việc phải làm**

- [ ] Đổ ảnh vào `photos/`, clip gốc vào `footage/raw/`.
- [ ] **Xem hết clip gốc một lượt và lập bảng kiểm kê**: mỗi đoạn dùng được ghi `file + mốc vào/ra + nội dung + độ phân giải + fps + đánh giá (tốt/tạm/loại)`. Cộng tổng số phút "tốt + tạm" — con số này quyết định kịch bản dài được bao nhiêu. Làm trước Phase 0 nếu kịch bản chưa chốt.
- [ ] Loại thẳng: đoạn rung mạnh, mất nét, ngược sáng cháy, có nhãn thời gian của camera, có mặt người không xin phép quay cận.
- [ ] Cắt và chuẩn hoá subclip bằng `scripts/prepareFootage.mjs` (**đã có**):

  ```powershell
  npm run footage:prepare -- --project projects/antt-lao-bao-2026 `
    --in footage/raw/hoi-nghi-tuyen-truyen.mp4 --start 00:00:12.5 --duration 7 `
    --out footage/clips/c03-hoi-nghi-tuyen-truyen.mp4 --label "Công an xã tuyên truyền pháp luật"
  ```

  Mỗi subclip ra đúng: `1920×1080`, `30 fps`, `yuv420p`, `SAR 1:1`, **không có tiếng** (`-an`), `libx264 -crf 18`. Clip dọc/vuông được `scale` + `pad` trên nền chính nó làm mờ (`boxblur`) chứ **không** để engine cover-crop mất người. Script **ffprobe lại file vừa xuất** và ném lỗi nếu sai bất kỳ thông số nào — đây là chỗ dễ trôi nhất nên đừng bỏ qua thông báo.
  Ghi bổ sung vào `footage/footage.json`: `{file, duration, src, srcIn, label, orient, width, height, fps}`.

- [ ] Chạy `npm run analyze:assets` để đối chiếu catalog.
- [ ] Duyệt lại ảnh: preflight cảnh báo "very large image" khi cạnh lớn nhất **> 4× cạnh khung** (tức **> 7680px** với phim 1920×1080), xem [preflightTimeline.ts:102-107](src/preflightTimeline.ts#L102-L107) — engine tự cache lại nên chỉ là cảnh báo, không phải lỗi.

**Cạm bẫy**

- Clip điện thoại quay dọc mà cover-crop vào 16:9 thì **mất đầu người**. Phải `pad` chứ không `crop`.
- Clip 60 fps/120 fps (quay chậm) phải hạ về 30 fps ở bước này, đừng để xảy ra lúc render.
- Clip có logo/nhãn thời gian của camera → cắt bỏ hoặc chọn đoạn khác.

**Nghiệm thu:** `ffprobe` mọi file trong `footage/clips/` cho ra cùng một bộ thông số; mỗi subclip **dài hơn** cảnh sẽ dùng ít nhất 0,5s.

---

### Phase 2 — Giọng đọc AI tiếng Việt

**Chọn engine/nhà cung cấp.** Repo hiện **không có** tích hợp TTS nào; `.env.example` chỉ có key vision (OpenAI) và DeepSeek. Cần chọn và thử thật:

| Nhà cung cấp | Ưu | Nhược | Hợp với |
|---|---|---|---|
| **[VieNeu-TTS](https://github.com/pnnbao97/VieNeu-TTS)** | Mã nguồn mở Apache 2.0, chạy offline, SDK Python, có giọng ba miền và hỗ trợ sinh batch cho văn bản dài | v3 Turbo còn early access; phải khóa phiên bản/model và kiểm tra độ nhất quán giữa các đoạn | **Khuyến nghị mặc định**; ưu tiên v2 cho bản sản xuất, thử v3 Turbo trên bản nháp |
| **FPT.AI TTS** | Giọng Việt bản địa, có giọng chất phát thanh viên (Bắc/Trung/Nam), giá theo ký tự rẻ, có gói dùng thử | API trả về **link file bất đồng bộ** — phải poll; SSML hạn chế | Phương án đối chứng/dự phòng nếu giọng local chưa đạt |
| **Viettel AI TTS** | Giọng Việt tốt, nhà cung cấp trong nước (thuận lợi khi khách là cơ quan nhà nước) | Cần đăng ký doanh nghiệp | Khi bên đặt hàng yêu cầu dịch vụ nội địa |
| **Azure Speech (vi-VN neural)** | SSML đầy đủ (chỉnh tốc độ/cao độ/ngắt nghỉ), có **word-boundary event** → đồng bộ phụ đề tới từng chữ, SLA ổn định | Cần thẻ quốc tế | Khi cần khớp phụ đề chính xác |
| **ElevenLabs multilingual** | Biểu cảm nhất, có API timestamps | Đắt nhất; accent Việt đôi khi lai | Khi cần giọng "kể chuyện" thay vì "phát thanh" |
| **OpenAI TTS** | Đã có sẵn khoá trong máy | Phát âm tiếng Việt **không chuẩn bằng** nhà cung cấp bản địa, nhất là tên riêng | Chỉ dùng làm bản nháp |

- [ ] **Thử trước khi cam kết**: lấy ít nhất 3 đoạn khó trong kịch bản, gồm “Lao Bảo, Quảng Trị”, chuỗi số liệu hành chính và đoạn về “Tổ cảm hóa, giáo dục người sử dụng trái phép chất ma túy”. Sinh bằng VieNeu-TTS và ít nhất một phương án đối chứng. Tiêu chí: đúng số, tên riêng, từ Hán-Việt, nhịp phóng sự và giọng nhất quán qua các chunk.
- [ ] Chi phí/dung lượng xử lý phải tính theo **11.641 ký tự hiện tại** và cập nhật lại sau biên tập. Với VieNeu-TTS local, dự trù thời gian GPU/CPU và dung lượng model; với API thương mại, áp bảng giá hiện hành theo ký tự.

**Phần code — đã dựng xong**

- ✅ `scripts/lib/tts/index.mjs` — interface chung, mỗi nhà cung cấp một adapter:
  ```js
  // synthesize({ text, voice, speed, style, format }) -> Buffer (wav)
  ```
  Đã có `scripts/lib/tts/vieneu.mjs` (gọi SDK Python qua `scripts/lib/tts/vieneu_bridge.py`, chạy dạng server nên **nạp model một lần cho cả kịch bản**) và `scripts/lib/tts/fptai.mjs` (có poll link bất đồng bộ, timeout 120s). Thêm Azure/Viettel = thêm một file vào thư mục đó; đổi nhà cung cấp = đổi `voice.provider` trong `script.json`, không sửa builder.
- ✅ `scripts/synthesizeNarration.mjs`:
  1. Đọc `script/script.json`, lấy từng `beat.narration`.
  2. **Cache theo hash** `sha256(text + provider + voice + speed + style)` vào `voice/cache/` — sửa một câu chỉ gọi lại một câu. File cache được ghi ra tên tạm rồi mới `rename` vào chỗ, nên một lần Ctrl-C giữa chừng **không** để lại file cụt bị mọi lần chạy sau coi là cache hợp lệ.
  3. Sinh từng câu → `voice/lines/<beatId>.wav`, đo độ dài bằng cách đọc thẳng header RIFF (không cần ffprobe).
  4. **Ghép một file duy nhất** `voice/narration.wav`: `[lặng đầu 0.8s] câu1 [nghỉ] câu2 [nghỉ] …`. Khoảng nghỉ mặc định 0,45s, nghỉ giữa các phần lớn 1,2s, khai báo trong `script.json` (`beat.pauseAfter`). Sau khi ghép, script **đối chiếu độ dài WAV thật với mốc thời gian đã tính**, lệch quá 0,1s là ném lỗi — `narration.json` không thể nói dối timeline.
  5. Ghi `voice/narration.json` (`segments[].end` là lúc **hết tiếng**, chưa tính khoảng nghỉ — nên dùng thẳng được cho phụ đề).
  6. Chuẩn hoá về **-18 LUFS bằng loudnorm hai lượt** (`linear=true`): lượt một đo, lượt hai áp **một hệ số khuếch đại tĩnh**. Không dùng loudnorm một lượt — nó là bộ nén động, trên câu ngắn thì đo sai và nén mỗi câu một kiểu, đúng vào cái mà mục nghiệm thu "giọng không đổi bất thường giữa các chunk" đang canh.
- ✅ Cờ `--stitch-only`: ghép lại từ `voice/lines/*.wav` mà không gọi TTS — dùng sau khi sửa tay file câu.

**Cạm bẫy**

- Engine chỉ nhận **một** `audio.voiceover`. Đây chính là lý do phải ghép. Đừng cố nhét nhiều đoạn.
- Số và viết tắt: `ANTT`, `PCCC`, `83,4 km²`, `23.890`, `12/12`, `03/03`, `07/07`, `2026`, `2030` — TTS dễ đọc sai. Trong `script.json` tách `narration` (viết bung cho máy đọc) khỏi `caption` (giữ cách viết chuẩn để hiện trên màn hình).
- Nếu tự chỉnh sửa thủ công `voice/lines/*.wav` (cắt bớt hơi thở chẳng hạn) thì **phải chạy lại bước ghép** để `narration.json` khớp — nếu không toàn bộ timeline lệch.

**Nghiệm thu:** nghe hết `narration.wav`, đúng nội dung, tên riêng và số liệu; giọng không đổi bất thường giữa các chunk; `narration.json` có đủ segment cho mọi beat; `totalDuration` khớp `ffprobe` trong sai số 0,1s. Không ép file đọc về một mốc thời lượng định sẵn.

---

### Phase 3 — Dựng timeline theo lời đọc

- ✅ Schema `script/script.json` (sinh sẵn bằng `npm run narration:import`, sau đó **sửa tay** để gán hình):
  ```json
  {
    "reviewStatus": "needs-content-approval",
    "project": { "name": "Toàn dân bảo vệ an ninh Tổ quốc - Lao Bảo 2026", "width": 1920, "height": 1080,
                 "fps": 30, "quality": "high", "maxShotDuration": 9, "closingDuration": 4 },
    "voice": { "provider": "vieneu", "voice": "Phạm Tuyên", "style": "tin_tuc", "speed": 0,
               "leadingSilence": 0.8, "defaultPause": 0.45 },
    "music": [{ "path": "music/nen-phong-su.mp3", "volume": 0.16 }],
    "beats": [
      { "id": "b001", "section": "mo-dau",
        "narration": "Trải qua chặng đường hai mươi mốt năm bền bỉ và kiên cường, phong trào toàn dân bảo vệ an ninh Tổ quốc tại xã Lao Bảo đã từng bước khẳng định vai trò trung tâm của Nhân dân.",
        "pauseAfter": 1.2,
        "caption": "AN NINH TỪ NHÂN DÂN, VÌ NHÂN DÂN",
        "visuals": [
          { "kind": "clip", "src": "footage/clips/c01-toan-canh-lao-bao.mp4" },
          { "kind": "photo", "src": "photos/cua-khau-sang-som.jpg" }
        ],
        "transition": { "type": "fade_slow", "duration": 1.0 } },
      { "id": "b002", "section": "dia-ban-lao-bao",
        "narration": "Là địa bàn biên giới, cửa khẩu, đông dân và đa dạng về thành phần cư trú, Lao Bảo đòi hỏi công tác giữ gìn an ninh, trật tự luôn chủ động, linh hoạt và bám sát thực tiễn.",
        "visual": { "kind": "photo", "src": "photos/lao-bao-cua-khau.jpg", "effect": "slow_zoom_in", "easing": "gentle" } }
    ]
  }
  ```
  `visual` (một hình) và `visuals` (nhiều hình) đều được. **Một beat đọc lâu hơn `maxShotDuration` sẽ cần đúng số hình bằng số phần bị chia** — builder nói thẳng cần bao nhiêu, ví dụ `b007 (needs 3 distinct visuals)`. Với cách cắt beat hiện tại (~280 ký tự ≈ 20–25 giây đọc), **hầu hết beat sẽ cần 3 hình** — xem quyết định số 4 ở mục 6.
- ✅ `scripts/buildNarratedTimeline.mjs` — hợp nhất `script.json` + `narration.json` → `timeline/antt-lao-bao.json`:

  **Quy tắc dựng (đã viết thành code, không dựng tay):**
  1. Mỗi beat chiếm một **cửa sổ thời gian** `[đầu câu này, đầu câu sau)`. Vì engine hiểu `slide.transition` là chuyển **ra** slide sau, slide được ghi `duration = độ dài cửa sổ + độ dài transition` — nhờ vậy phần đóng góp thật của nó vào phim đúng bằng cửa sổ, và **tổng thời lượng phim khớp tuyệt đối với `narration.totalDuration`**.
  2. **Chặn cứng 2–30s**: cửa sổ < 2s được gộp với cửa sổ kế — gộp **lặp lại đến khi đủ 2s**, vì một lần gộp không phải lúc nào cũng đủ. Cửa sổ dài hơn `project.maxShotDuration` (mặc định 9s) bị chia đều thành nhiều slide, **mỗi phần đòi một hình riêng**.
  3. **Điểm cắt lùi vào khoảng nghỉ.** Nếu để mốc cắt đúng ngay đầu câu sau thì engine *bắt đầu* hoà hình đúng lúc câu mới cất tiếng, hình mới chỉ hiện đủ khi câu đã đọc được 0,6–1,0s. Builder lùi mốc lại đúng bằng độ dài transition để hoà hình **kết thúc** khi câu mới bắt đầu — nhưng không bao giờ cắt vào tiếng đang đọc, cũng không kéo cửa sổ xuống dưới 2s.
  4. `visual.kind === "clip"` → `effect: "video_background"`, `background: <clip>`; **kiểm tra `clip.duration ≥ slide.duration`**, không đạt thì dừng ngay chứ không để engine lặp clip lúc render. Hai slide liền nhau dùng chung một clip thì **cảnh báo** — clip sẽ chạy lại từ giây 0, nhìn ra ngay.
  5. `visual.kind === "photo"` → ken-burns nhẹ (`slow_zoom_in` mặc định), `easing: "gentle"`. `easing` **chỉ** được gắn khi effect thuộc nhóm zoompan; gắn nhầm chỗ khác là `validateTimeline` chặn cả phim.
  6. `caption` → `captions[]` có `outline` + `shadow`, font `BeVietnamPro-Regular.ttf`, `start` 0,3s và kết thúc trước slide 0,3s. Cửa sổ bị chia nhiều phần thì caption **chỉ hiện ở phần đầu**, không lặp lại ở mỗi nhát cắt.
  7. Slide đầu = **card tiêu đề**, slide cuối = **khẩu hiệu + đơn vị**, cả hai là `layer_scene`.
  8. `audio.voiceover = { path: "voice/narration.wav", start: 0, volume: 1.0, ducking: true }`.
  9. Tổng thời lượng phim phải **≥** `narration.totalDuration`; ngắn hơn là câu cuối bị cắt cụt — script dừng và báo.
- [ ] Chạy `node scripts/fitTextInTimeline.mjs projects/antt-lao-bao-2026/timeline/antt-lao-bao.json` để co chữ cho vừa khung.

> **Đọc dòng `[warning]` builder in ra.** Cảnh báo không chặn dựng nhưng đều là chỗ phim sẽ
> lộ: tư liệu đã gán mà không có chỗ hiện, caption bị bỏ khi hai beat gộp lại, clip chạy lại
> từ đầu ở nhát cắt.

**Nghiệm thu:** `npm run render -- --timeline projects/antt-lao-bao-2026/timeline/antt-lao-bao.json --dry-run` chạy sạch, không lỗi validate, log preflight không có `errors`.

---

### Phase 4 — Nhạc nền và trộn âm

- [ ] **Bản quyền nhạc — làm trước khi chọn bài.** Video tuyên truyền là phát hành công khai, dùng nhạc lậu là rủi ro pháp lý cho bên đặt hàng. Chọn nhạc royalty-free có giấy phép rõ ràng, lưu file giấy phép vào `music/`. Repo đã có `server/services/musicProvenance.ts` cho phần này ở luồng sản phẩm.
- [ ] Tính chất nhạc: trang trọng, tin cậy, có chiều sâu và nâng dần ở phần kết; **không lời**, không bi lụy, không tạo cảm giác hình sự giật gân. Dùng 4–5 track cùng bảng màu âm nhạc cho phim dài.
- [ ] Thông số khởi điểm:
  ```json
  "music": [{ "path": "music/nen-phong-su.mp3", "volume": 0.16 }],
  "audio": { "fade_in": 1.5, "fade_out": 3.0, "crossfade": 2.0,
             "voiceover": { "path": "voice/narration.wav", "start": 0, "volume": 1.0, "ducking": true } }
  ```
- [ ] Nếu ducking sidechain chưa đủ (nhạc vẫn lấn), dùng thêm `audio.automation` để hạ tay ở các đoạn nói dày, và **nâng** nhạc lên 0,35–0,45 ở khoảng lặng giữa các phần — đây chính là chỗ tạo nhịp cảm xúc cho video tuyên truyền.
- [ ] Chuẩn âm lượng đầu ra: **-16 LUFS** cho web/YouTube; **-23 LUFS (EBU R128)** nếu nộp cho đài truyền hình. Engine chưa có bước loudnorm ở khâu cuối — đo bằng `ffmpeg -af loudnorm=print_format=summary` rồi chỉnh `volume` cho khớp, hoặc thêm một bước hậu kỳ riêng.

**Nghiệm thu:** nghe bằng loa ngoài **và** tai nghe; mọi chữ trong lời bình đều nghe rõ; nhạc không biến mất hẳn khi có giọng (ducking quá tay nghe như hỏng file).

---

### Phase 5 — Render và kiểm định

```powershell
# 1. Chạy khô — bắt lỗi validate trước khi đốt thời gian render
npm run render -- --timeline projects/antt-lao-bao-2026/timeline/antt-lao-bao.json --job-dir projects/antt-lao-bao-2026 --dry-run

# 2. Render thật
npm run render -- --timeline projects/antt-lao-bao-2026/timeline/antt-lao-bao.json --job-dir projects/antt-lao-bao-2026

# 3. Contact sheet để soi khung hình
node scripts/generateContactSheet.mjs projects/antt-lao-bao-2026/timeline/antt-lao-bao.json --out projects/antt-lao-bao-2026/analysis/contact.jpg
```

**Checklist kiểm định (bắt buộc xem hết, không chỉ tua):**

- [ ] Chữ tiếng Việt **hiện đủ dấu**, không ô vuông, không tràn khung, không đè lên mặt người.
- [ ] Giọng đọc khớp hình: số liệu địa bàn đi với hình Lao Bảo; đoạn mô hình cảm hóa đi với đúng hoạt động, không dùng hình minh họa gây kỳ thị hoặc làm lộ danh tính người được hỗ trợ.
- [ ] Không clip nào bị **lặp lộ liễu** (dấu hiệu: subclip ngắn hơn slide).
- [ ] Cắt cảnh rơi vào **khoảng nghỉ giữa câu**, không cắt giữa chừng một câu.
- [ ] Đọc `projects/antt-lao-bao-2026/logs/` tìm dòng `[preflight warning]` — nhất là cảnh báo `crop risk`.
- [ ] Đối chiếu lần cuối mọi caption số liệu với bảng kiểm chứng đã duyệt; không lấy cách phát âm đã viết bung trong `narration` để hiển thị lên hình.
- [ ] Xem lại bằng skill `/watch` để soát khách quan.
- [ ] Người của đơn vị đặt hàng duyệt lần cuối.

**Cạm bẫy đã biết của repo**

- `temp/scene-cache/` **không tự invalidate** khi code renderer đổi. Nếu sửa engine (Phase 7) thì phải xoá cache, nếu không là đang nghiệm thu trên khung hình cũ.
- Ảnh xoay theo EXIF (ảnh máy cơ) cần bake sẵn góc xoay, engine không đọc EXIF ở mọi nhánh.

---

### Phase 6 — Bản phái sinh và bàn giao

- [ ] Bản dọc 9:16 cho mạng xã hội + teaser **30–60 giây** (thời lượng teaser chốt riêng theo kênh phát):
  ```powershell
  npm run social -- --project projects/antt-lao-bao-2026 --timeline projects/antt-lao-bao-2026/timeline/antt-lao-bao.json
  ```
  **Lưu ý:** `retargetTimeline()` để nguyên slide `video_background` (chỉ cover-crop vào khung dọc) và **chưa dời vị trí `captions[]`** cho khung mới — phải xem lại bản dọc bằng mắt, có thể phải chỉnh tay `timeline/social/vertical.json`.
- [ ] Xuất phụ đề `.srt` từ `voice/narration.json` — cần cho người khiếm thính và cho việc phát không tiếng ở màn hình công cộng:
  ```powershell
  npm run narration:srt -- --project projects/antt-lao-bao-2026
  ```
  Một beat là cả một đoạn văn, nên script **cắt tiếp thành cue đọc được** (tối đa ~84 ký tự, hai dòng cân nhau) và chia thời gian theo độ dài từng cue. File `.srt` nằm cạnh file phim, cùng tên.
- [ ] Đóng gói bàn giao: bản 16:9 master, bản 9:16, poster, file `.srt`, kịch bản đã duyệt, giấy phép nhạc.

---

### Phase 7 — Mở rộng engine (tuỳ chọn, chỉ làm nếu v1 cho thấy thiếu)

Xếp theo **giá trị / công sức**:

1. **Điểm vào cho clip** — thêm `slide.clipStart` (giây), sửa `buildVideoBackgroundArgs` thành `-ss <clipStart> -i clip`. *Nhỏ, gọn.* Bỏ được bước cắt subclip thủ công.
2. **Không lặp clip** — bỏ `-stream_loop -1` khi `clip.duration ≥ slide.duration`, thay bằng giữ khung cuối. Xoá hẳn một lớp cạm bẫy.
3. **Layer video trong `layer_scene`** — thêm nhánh `type: "video"` vào `$defs/layer` + `buildLayerSceneCommand.ts`. *Đây là việc lớn nhất và đáng giá nhất*: mở ra chia đôi màn hình, clip trong khung, clip cạnh ảnh.
4. **Giữ tiếng hiện trường** — cần đường dẫn audio đi xuyên qua khâu nối (hiện `xfade` chỉ map `[vout]`, tiếng của slide bị bỏ). Việc này **đụng vào kiến trúc**, không nằm trong v1 đã chốt.
5. **Nhiều đoạn voiceover** — `audio.voiceover` thành mảng. Chỉ cần nếu bỏ cách ghép một file.

> Mọi thay đổi engine **bắt buộc** chạy `npm run check` (typecheck + build + docs:check + test:api + test:unit + test:integration + audit). Gate này đang xanh — đừng làm nó đỏ.

---

## 3. Bảng rủi ro

| Rủi ro | Mức | Xử lý |
|---|---|---|
| Giọng TTS đọc sai tên riêng/số liệu | **Cao** | Tách `narration` (viết bung cho máy đọc) khỏi `caption`; nghe duyệt từng câu ở Phase 2 |
| Kịch bản còn câu cụt/lỗi nhận dạng | **Cao** | Biên tập có kiểm soát; chỗ thiếu nghĩa phải hỏi người phụ trách, không tự đoán |
| Nội dung/số liệu sai, phải làm lại | **Cao** | Lập bảng kiểm chứng và ký duyệt `script.md` ở Phase 0, trước mọi việc khác; `reviewStatus` chặn cả TTS lẫn dựng timeline cho tới khi có chữ ký |
| Chạy lại `narration:import` làm mất công gán hình | **Cao** | Script từ chối ghi đè `script.json` đã có; chỉ `--force` mới xoá được (đọc kỹ câu cảnh báo — nó đếm sẵn bao nhiêu beat sẽ mất) |
| Hình ảnh làm lộ danh tính người được cảm hóa/hỗ trợ | **Cao** | Chỉ dùng tư liệu đã được phép; ưu tiên toàn cảnh, góc sau hoặc hình hoạt động chung |
| Nhạc không có bản quyền | **Cao** | Chốt giấy phép trước khi chọn bài; lưu file giấy phép |
| Clip quay dọc bị cắt mất người | Trung bình | `pad` chứ không `crop` ở Phase 1; `prepareFootage.mjs` tự làm và tự kiểm tra lại |
| Clip lặp lộ liễu | Trung bình | Builder **chặn** khi `clip.duration < slide.duration`, và **cảnh báo** khi hai slide liền nhau dùng chung một clip |
| Beat dài > 30s vỡ ràng buộc schema | Trung bình | Builder tự chia theo `maxShotDuration`; gộp lặp lại cho tới khi đủ 2s; có test cho cả hai luật |
| Cắt cảnh rơi trúng chữ đầu câu | Trung bình | Builder tự lùi mốc cắt để hoà hình kết thúc đúng lúc câu mới bắt đầu; có test khoá lại |
| Nhạc lấn giọng đọc | Trung bình | `ducking: true` + `automation` + nghe bằng loa ngoài |
| Chữ tràn khung / font không đủ dấu | Thấp | Chỉ dùng BeVietnamPro/Montserrat cho lời bình; chạy `fitTextInTimeline.mjs` |
| Tốn thời gian sinh lại giọng khi sửa kịch bản | Thấp | Cache TTS theo hash từng câu; khóa nội dung trước khi sinh toàn bộ |

---

## 4. Ước lượng công sức

| Giai đoạn | Việc | Ước lượng |
|---|---|---|
| Phase 0 | Biên tập, kiểm chứng số liệu + duyệt | 1–2 ngày, chưa tính thời gian chờ xác nhận |
| Phase 1 | Kiểm kê kho clip + cắt subclip *(script đã có)* | 1–2 ngày, tuỳ lượng clip |
| Phase 2 | ~~Adapter TTS + script~~ **xong**; còn lại: cài VieNeu, thử giọng, nghe duyệt | 0,5 ngày |
| Phase 3 | ~~Builder~~ **xong**; còn lại: **gán hình cho từng beat** | 1–2 ngày (việc tay, tỉ lệ thuận với số beat) |
| Phase 4 | Playlist + trộn âm | 0,5–1 ngày |
| Phase 5 | Render + xem hết phim + sửa | 1–2 ngày; mỗi lượt render có thể mất hàng giờ ở `high` |
| Phase 6 | Bản phái sinh + bàn giao | 0,5 ngày |
| **Còn lại cho v1** | | **≈ 5–8 ngày công**, gần như toàn bộ là việc nội dung và tư liệu, không phải code |
| Phase 7 | Mở rộng engine | +2–4 ngày nếu làm mục 3 (layer video) |

> Đường găng đã dịch: phần code không còn là chỗ nghẽn. Chỗ nghẽn bây giờ là **duyệt số liệu**
> và **gán hình cho từng beat** — hai việc không ai code hộ được.

---

## 5. Định nghĩa "xong" cho v1

- [ ] `projects/antt-lao-bao-2026/output/antt-lao-bao-2026.mp4` — 1920×1080, 30fps; thời lượng đủ chứa toàn bộ `narration.wav`, khoảng nghỉ và phần mở/kết theo kịch bản đã duyệt (hiện dự kiến 17–19 phút).
- [ ] Có **cả** ảnh và clip quay thật; ít nhất 1/3 thời lượng là clip.
- [ ] Giọng đọc AI tiếng Việt bám sát kịch bản đã duyệt, khớp hình từng đoạn.
- [ ] Nhạc nền có bản quyền, chìm dưới giọng đọc, không át lời.
- [ ] Chữ tiếng Việt hiển thị đúng dấu, trong khung an toàn.
- [ ] Kèm bản 9:16, file `.srt`, poster.
- [ ] Toàn bộ tái lập được từ `script.json` + tư liệu bằng chuỗi lệnh sau (chạy từ thư mục gốc repo — mọi đường dẫn trong timeline là tương đối với nơi gọi lệnh):
  ```powershell
  npm run narration:synthesize -- --project projects/antt-lao-bao-2026
  npm run narration:timeline   -- --project projects/antt-lao-bao-2026
  npm run narration:srt        -- --project projects/antt-lao-bao-2026
  npm run render -- --timeline projects/antt-lao-bao-2026/timeline/antt-lao-bao.json --job-dir projects/antt-lao-bao-2026
  ```
  (`narration:import` và `footage:prepare` chỉ chạy một lần lúc dựng kho, không nằm trong vòng tái lập.)
- [ ] `npm run check` vẫn xanh (nếu có đụng vào code engine).

---

## 6. Bốn việc cần quyết — bây giờ là việc của người, không phải của code

1. **Chốt model/giọng nào?** Đề xuất VieNeu-TTS v2 chạy local cho bản sản xuất; thử v3 Turbo và FPT.AI trên cùng ba đoạn khó trước khi khóa giọng. Nếu clone giọng, phải có chấp thuận bằng văn bản của chủ giọng. *Lưu ý kỹ thuật: adapter VieNeu **không giả lập tốc độ đọc** — nó ném lỗi nếu `voice.speed ≠ 0`. Nhịp đọc phải duyệt từ chính giọng sinh ra, không chỉnh bằng hệ số.*
2. **Kho tư liệu có phủ đủ kịch bản 17–19 phút không?** Cần kiểm kê tối thiểu khoảng 6 phút clip tốt nếu giữ mục tiêu ≥1/3 thời lượng là clip; đoạn nào thiếu hình phải rút hoặc viết lại trước khi dựng.
3. **Ai ký duyệt bản biên tập và số liệu?** Phải có đầu mối xác nhận các câu đang cụt/nghi sai và toàn bộ số liệu hành chính, thành tích trước khi sinh TTS. Cho tới lúc đó `reviewStatus` phải để nguyên là `needs-content-approval`.
4. **Beat dài bao nhiêu?** Hiện `narration:import` cắt kịch bản thành đoạn ~280 ký tự ≈ **20–25 giây đọc**. Đánh đổi:
   - **Giữ nguyên**: ngữ điệu liền mạch nhất (TTS đọc trọn cả đoạn), nhưng mỗi beat phải gán **3 hình**, và sửa một câu là phải sinh lại cả đoạn ~60 chữ.
   - **Cắt theo câu** (hạ `target` trong `splitNarration` xuống ~140): mỗi beat ≈ một câu, một hình, sửa câu nào sinh lại câu đó — đúng như lý do đặt ra cái cache. Đổi lại các câu được đọc rời nên phải nghe kỹ chỗ nối.
   Quyết định này chỉ là **một con số**, nhưng phải chốt **trước khi** sinh toàn bộ giọng, vì đổi nó là mất sạch cache.
