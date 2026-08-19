# Kế hoạch: đưa pipeline phóng sự thành một sản phẩm dùng lại được

> Lập ngày 2026-08-19, dựa trên code đã chạy ra phim thật (`projects/antt-lao-bao-2026`),
> không dựa trên kế hoạch cũ.
>
> Đặt ở thư mục gốc vì cùng lý do với `GO-LIVE-PLAN.md` và `PLAN-VIDEO-TUYEN-TRUYEN-TDTT.md`:
> `scripts/checkDocs.mjs` phân giải link tương đối theo thư mục chứa file.

**Mục tiêu:** đầu vào là *kịch bản đọc + nhạc + ảnh + video*, đầu ra là *một file .mp4 hoàn chỉnh*,
và làm được điều đó cho phim **thứ hai** mà không sửa một dòng code nào.

---

## 0. Khoảng cách giữa hiện tại và mục tiêu

Phim thứ nhất đã ra: 53 beat → 106 slide → **11m46s**, 81 ảnh + 18 clip, giọng VieNeu 11m42s.
Engine không phải sửa gì. Nhưng làm phim thứ hai thì vướng bốn chỗ, xếp theo mức chặn:

| # | Điểm chặn | Bằng chứng |
|---|---|---|
| **1** | **Gán tư liệu hoàn toàn thủ công** | 99 visual đặt tay trên 53 beat, mỗi cái tự chọn `pool` + `effect`. Không có script nào trong `scripts/`. Đây là nhiều ngày công người và là **đường găng thật**. |
| **2** | **Importer là script dùng-một-lần** | `importNarrationScript.mjs` hardcode: đúng 11 đoạn, 6 section id, 6 tiêu đề, thẻ mở, khẩu hiệu kết, tên dự án, tên đơn vị, kích thước, đường dẫn output, giọng đọc. Kịch bản khác ném lỗi ngay ở bước đếm đoạn. |
| **3** | **Không có mặt trên web** | Web app biết `template \| lite \| premium`. Không có tier phóng sự, không có chỗ nộp kịch bản, không có màn duyệt nội dung. |
| **4** | **Nhạc chưa rõ giấy phép** | `input/music/Motivating and Upbeat Background Music - (320 Kbps).mp3` — chưa qua `assertLicensedMusic`, và file đó không nằm trong `music/` nên guard hiện tại không thấy. |

Thứ tự dưới đây là thứ tự **bắt buộc**: N1 mở khoá N2, và N2 là thứ quyết định pipeline này có
dùng được ở quy mô hay không. N3 chỉ là gói lại. N4 làm sau, và chỉ khi có nhu cầu thật.

---

## N1 — Tổng quát hoá importer  ✅ XONG 2026-08-19

**Vấn đề:** mọi quyết định biên tập của phim ANTT đang nằm trong mã nguồn chứ không trong dữ liệu.

**Việc:**

- **Section lấy từ chính markdown**, không từ mảng hardcode. Dùng heading cấp 2 làm ranh giới
  section; chữ của heading là tiêu đề hiển thị, slug của nó là section id. Người viết kịch bản
  điều khiển được số section và tên section mà không đụng code — và bước đếm-11-đoạn biến mất.
- **Metadata dự án ra một khối front-matter** ở đầu file `.md` (hoặc `--config <json>`): tên phim,
  đơn vị phát hành, kích thước, fps, khẩu hiệu kết, thẻ mở, giọng đọc, `maxShotDuration`.
- **Chốt độ dài beat.** Mặc định `target=280 / hardLimit=380` chưa ai quyết. Phải chốt **ở bước này**,
  vì cache TTS khoá theo `sha256(text, provider, voice, speed, style)` — đổi cách cắt là **mọi dòng
  đã tổng hợp mất hiệu lực**, tức tổng hợp lại toàn bộ phim. Đổi sau khi có 3 phim là đổi 3 lần tiền.
- Giữ nguyên hai thứ đã đúng: từ chối ghi đè `script.json` đã có, và quy tắc `pauseAfter` 1.2s đặt
  ở beat **đóng** section.

**Nghiệm thu:** import hai kịch bản khác nhau về số đoạn và số section, không sửa dòng code nào;
import lại kịch bản ANTT cho ra `script.json` tương đương bản đang có (so sánh beat text).

**Quy mô:** nhỏ. Phần lớn là gỡ hằng số ra thành dữ liệu.

### Đã làm

- Section lấy từ heading `##`; `{#id}` ghim id thủ công, không ghim thì slug từ tiêu đề.
  `#` cấp một đặt tên phim. Bước đếm-đúng-11-đoạn đã biến mất.
- Metadata ra front-matter JSON (không phải YAML: kịch bản là văn xuôi tiếng Việt đầy dấu
  nháy và dấu thanh, `JSON.parse` có đúng một cách hiểu cho tất cả). `--config` sidecar đè
  lên front-matter, cho người viết không muốn nhúng JSON.
- `beat.target/hardLimit` thành cấu hình **theo dự án**. Đây là cách câu hỏi 280-ký-tự được
  đóng lại: nó không còn là hằng số trong mã mà là một lựa chọn của từng phim — nhưng phải
  chốt **trước** lần tổng hợp giọng đầu tiên, vì cache TTS khoá theo chữ của beat.
- Validate ngay lúc import những giá trị mà builder chỉ bắt được sau khi TTS đã tốn phút thật.
- Giữ nguyên: chặn ghi đè `script.json`, và `pauseAfter` đặt ở beat **đóng** section.

### Nghiệm thu (đo được)

- **Importer mới dựng lại kịch bản ANTT bằng đúng importer cũ**: 53/53 beat trùng tuyệt đối
  về chữ, section, caption và `pauseAfter`. So sánh chạy trên cùng `script/script.md`.
- Một kịch bản khác hẳn (2 section, front-matter riêng, giọng khác, `maxShotDuration` khác)
  import trót lọt qua CLI, **không sửa dòng code nào**.
- 9 test mới trong `test/narration-import.test.mjs`.

### Hai phát hiện ngoài dự kiến

1. **`script.md` và `script.json` của ANTT đã trôi khỏi nhau**: 11/53 beat lệch chữ và 11/53
   lệch `pauseAfter`. `.md` là bản gỡ băng thô (còn "hòa ra phong trào"), `.json` là bản đã
   sửa tay. Nghĩa là **nguồn sự thật hiện nằm ở `script.json`**, và mọi lần re-import đều sẽ
   xoá công sửa đó — đúng thứ mà cổng chặn ghi đè sinh ra để ngăn. Muốn re-import được thì
   phải chép các sửa chữa ngược về `.md` trước.
2. **`slug()` nuốt mất chữ đ** — ở CẢ HAI bản, `scripts/lib/project.mjs` và
   `server/services/projects.ts`. đ/Đ là một chữ cái riêng nên NFD không tách nó, rồi bộ lọc
   `[^a-z0-9]` xoá luôn. Hệ quả phía server là id dự án của khách: `"Đức & Hà"` → `"uc-ha"`,
   `"Đám cưới Đông Đô"` → `"am-cuoi-dong-do"`. Đã sửa cả hai, kèm test hồi quy hai phía.

---

## N2 — Tự gán tư liệu theo pool  ✅ XONG 2026-08-19

**Vấn đề:** đây là nút thắt. Nhưng bản gán tay đã để lại một cấu trúc rất dễ cơ giới hoá.

Phim ANTT gán theo **pool** — một nhóm chủ đề thô: `community` 40, `school` 12, `conference` 9,
`sport` 5, `vneid` 4, `memorial`/`pccc`/`rescue` 3, `establish`/`award` 1. Đây chính là cách con
người vốn đã sắp xếp tư liệu. Không cần khớp ngữ nghĩa từng câu với từng ảnh.

**Việc:**

- **Tư liệu nằm trong thư mục theo pool**: `photos/<pool>/`, `footage/clips/<pool>/`. Thư mục *là*
  nhãn — không cần công cụ gán nhãn riêng, và người biên tập đã làm việc đó khi đổ tư liệu vào máy.
- **Mỗi section khai báo pool được rút**, trong front-matter của N1. Beat kế thừa pool của section.
- **Bộ gán** (`scripts/assignNarrationVisuals.mjs`), với các luật rút ra từ chính bản gán tay và
  từ bài học đã trả giá:
  - **Tiêu landscape trước.** Album ANTT có 100/225 ảnh dọc và pillarbox từng lên 36% cho tới khi
    pool tiêu ảnh ngang trước. Đây là luật số một, không phải tinh chỉnh.
  - **Không lặp ảnh** trong cả phim; không để hai slide liền nhau cùng pool *và* cùng hướng.
  - **Xoay vòng effect** trong 10 effect đang dùng, không để hai slide cạnh nhau trùng effect.
  - **Clip ưu tiên mở section** (vai trò thiết lập bối cảnh), và không bao giờ hai slide liền nhau
    dùng cùng một clip — builder hiện chỉ *cảnh báo* chuyện này, bộ gán phải làm nó không xảy ra.
  - **Cửa sổ bị chẻ cần đủ visual**: `splitWindow` chẻ cửa sổ > `maxShotDuration` thành `partCount`
    phần, mỗi phần cần một visual riêng. Bộ gán phải đọc đúng số đó, nếu không builder sẽ chặn.
- **Người luôn đè được máy**: beat đã có `visual`/`visuals` viết tay thì bộ gán không đụng vào.
  Đây là điều kiện để dùng được thật — máy lo 90% nhàm chán, người sửa 10% quan trọng.

**Nghiệm thu:** chạy trên chính album ANTT (339 ảnh, 29 clip) cho ra ≥ 99 visual, **0 beat pending,
0 ảnh lặp**, và tỉ lệ pillarbox **không tệ hơn bản gán tay** — đo bằng cùng một script, lấy bản gán
tay làm mốc chứ không đặt một con số tự nghĩ ra. Builder chạy tiếp không cảnh báo clip-lặp.

**Quy mô:** vừa. Đây là chỗ đáng đổ công nhất.

### Đã làm — và một sửa đổi so với kế hoạch

**Không dựng thư mục `photos/<pool>/`.** Album ANTT đã có sẵn `analysis/photo-index.json`
(339 ảnh kèm w/h/hướng), `analysis/pools-curated.json` (11 pool → chỉ số, đã áp
`curation.json` loại 61 ảnh yếu + 45 trùng + 18 nhạy cảm) và `footage/footage.json`.
**Những file đó CHÍNH LÀ ý đồ biên tập**, do người soi contact sheet mà ra. Đẻ ra một cơ chế
thư mục song song là vứt bỏ phán đoán ấy rồi đi hỏi lại từ đầu. Bộ gán đọc thẳng chúng.

**Bỏ một luật của chính kế hoạch này.** Kế hoạch viết "không để hai slide kề nhau cùng pool".
Đo bản gán tay: **40 lần kề nhau cùng pool** — vì mỗi section vốn rút từ một pool. Luật đó
không phải khuyết điểm mà là hình dạng của một bộ phim có chương; ép ngược lại sẽ buộc bộ gán
với ra ngoài pool của section và rời khỏi những tấm ảnh ngang của nó — đánh đổi thứ **hiện lên
màn hình** (hai vệt đen hai bên) lấy thứ **không hiện lên** (ảnh lấy từ thư mục nào).

Luật thật, đọc ngược từ bản gán tay:

| | landscape | portrait/square |
|---|---|---|
| Effect | xoay vòng 9 effect zoompan | `portrait_blur_background` (lấp khung bằng bản blur) |

cộng: tiêu ảnh ngang trước, không lặp ảnh, không hai slide kề nhau trùng effect, clip mở
section và phải đủ dài cho slide, không hai slide kề nhau cùng một clip, và **beat nào
người đã gán thì không đụng vào** — ảnh của nó cũng bị gạch khỏi pool.

`planGroups()` được tách ra `narratedTimeline.mjs` dùng chung cho builder và bộ gán: cả hai
phải đồng ý số ảnh mỗi nhóm cần, lệch nhau là beat trắng hình hoặc ảnh không ai thấy.

### Nghiệm thu (đo được, trên chính album ANTT đặt lại về pending)

| | bản gán tay | bản tự động |
|---|---|---|
| visual | 99 (81 ảnh + 18 clip) | **99** (74 ảnh + 25 clip) |
| pillarbox | 6/81 = **7,4%** | 0/74 = **0,0%** |
| ảnh lặp | 0 | **0** |
| kề nhau trùng effect | 0 | **0** |
| beat còn pending | 0 | **0** |

Mọi cổng của builder đều qua khi dựng lại đúng các phép kiểm đó: đủ visual cho `partCount`,
không clip nào ngắn hơn slide, không hai slide kề nhau cùng clip. 10 test trong
`test/visual-assigner.test.mjs` (nhánh ảnh dọc phải test riêng — album này dư ảnh ngang nên
không bao giờ chạm tới nó).

### Còn hở

- **Bộ gán tiêu hết 25/25 clip, người chỉ dùng 18.** `footage.json` không có trường thẩm định
  nào cho clip, nên bộ gán không có cơ sở để chê clip xấu — trong khi ảnh thì có `curation.json`.
  Muốn khép lại thì cần một `curation` cho clip, không phải chỉnh tham số.
- Chạy thật vẫn cần `--write`; mặc định là chạy khô, vì nó ghi đè đúng file chứa công của người.

---

## N2b — Đạo diễn AI: AI đề xuất, người duyệt  ✅ XONG 2026-08-19

**Thay đổi chủ trương.** N5 của kế hoạch này khuyên KHÔNG dùng model để khớp câu với ảnh. Chủ
dự án đã cân nhắc và quyết định ngược lại: AI đọc kịch bản và ảnh rồi tự quyết định. Ghi lại ở
đây để sau này không ai tưởng là quên — và N5 bên dưới nay chỉ còn đúng phần "không dùng lại
`TAG_LIST` đám cưới".

Hình thức đã chọn: **AI đề xuất, người duyệt từng beat.** Không có đường nào để một lựa chọn của
model đi thẳng vào phim.

```
narration:propose  →  script/visual-review.json   (approved: false)
                          ↓  người đọc, sửa, đặt approved: true
narration:apply    →  script/script.json
```

### Ba tầng, mỗi tầng một việc

1. **Đạo diễn** (`lib/narrationDirector.mjs`) — dựng prompt và kiểm chứng câu trả lời. **Không
   gọi mạng**, nên test được không cần key, không tốn tiền.
2. **Guardrail** — sáu kiểu sai của model đều được sửa và **ghi vào `repairs`**: chỉ số không tồn
   tại, ảnh dùng hai lần, beat bị bỏ quên, effect engine không có, ảnh dọc bị gán motion ngang,
   clip ngắn hơn slide. Sửa lặng lẽ là nói dối người ký duyệt, nên mọi sửa chữa đều hiện tên.
3. **Người** — `approved: true` là chữ ký. `narration:apply` từ chối chạy nếu thiếu.

N2 không bị vứt: bộ gán tất định trở thành lưới lấp chỗ trống (`--fill`), và `beat.visuals` vẫn là
khớp nối duy nhất nên builder, cổng chặn và đường đè-tay không phải sửa gì.

### Một lỗi tự tìm ra trong chính code này

Danh sách ảnh chào cho model bị lọc còn 213/339 (phần còn lại bị `curation.json` loại), nhưng chỉ
số trong prompt vẫn là chỉ số album. Bản đầu tra `photos[index]` — **tra theo vị trí trong mảng đã
lọc**. Model trả index 50 sẽ ra ảnh khác; index 300 thì ngoài phạm vi. Đây là kiểu sai **không cổng
nào phía sau bắt được**: phim dựng trót lọt và chiếu nhầm ảnh dưới nhầm câu. Đã chuyển sang tra
theo `index` và có test hồi quy — đã chứng minh test đỏ trên code cũ.

### Trạng thái

- 12 test trong `test/narration-director.test.mjs`, chạy hoàn toàn bằng STUB.
- Đã chạy `--dry-run` trên album ANTT thật: 52 beat, 99 visual, 213 ảnh chào, **~5.500 token**.
  Text director rẻ gần như bằng không.
- **Chưa gọi API thật lần nào** — chủ dự án chưa duyệt chi tiêu.

### Còn thiếu: node vision

Hiện `analysis/photo-captions.json` chưa tồn tại, nên đạo diễn **chưa nhìn thấy ảnh** — nó chỉ biết
pool và hướng ảnh. Muốn khớp đúng nghĩa từng tấm thì cần một node vision mô tả 339 ảnh. Node vision
đám cưới sẵn có (`analyzePhotoContent.mjs`) **không dùng lại được**: nó import cứng `TAG_VOCAB` 29
tag đám cưới. Đây là hạng mục tốn tiền thật và đang chờ quyết định.

## N3 — Một lệnh chạy hết

**Việc:** `npm run narration:build -- --project <dir>` chạy tuần tự import → synthesize → timeline →
render, dừng ở cổng đầu tiên không qua và nói rõ vì sao. Không thêm năng lực mới, chỉ gói lại.

**Nghiệm thu:** từ một thư mục dự án trống + kịch bản `.md` + nhạc + `photos/<pool>/` +
`footage/clips/<pool>/`, một lệnh cho ra `.mp4` xem được.

**Quy mô:** nhỏ.

---

## N4 — Đưa lên web

Chỉ làm khi đã dựng được **phim thứ hai và thứ ba** bằng N1–N3. Trước đó thì chưa biết chỗ nào
thực sự cần giao diện.

- Tier thứ tư `narrated` bên cạnh `template | lite | premium`.
- Nộp kịch bản `.md`, nhạc, ảnh (kèm chọn pool lúc upload), clip.
- **Cổng duyệt nội dung thành một màn hình**, không phải sửa tay `reviewStatus` trong JSON.
  Đây là thứ *phải* lên web sớm nhất nếu có khách ngoài, vì nó là chỗ ký duyệt số liệu.
- Dùng lại nguyên: hàng đợi render (G2.6), `assertLicensedMusic` (G2.7), billing, backup.

---

## N5 — Cố ý không làm

- **Không khớp ngữ nghĩa câu-với-ảnh bằng vision model.** Pool đã nắm được ý đồ biên tập với 1/10
  độ phức tạp. Và trong một phim tuyên truyền, một tấm ảnh bị gán sai chỗ là sai lầm nặng hơn nhiều
  so với một tấm ảnh đúng nhưng nhạt — mô hình đoán sai thì không ai biết cho tới khi phát sóng.
- **Không dùng lại `TAG_LIST`.** 29 tag đều là cưới (`bride`, `vows`, `rings`, `first_dance`);
  không tag nào áp được. Muốn có vocab cho phóng sự thì đó là một hạng mục riêng, không phải
  sửa vài dòng.
- **Không tự động duyệt nội dung.** Cổng `reviewStatus` là thứ duy nhất chặn một con số sai đi ra
  bản giao. Nó phải do người bật.
- **Không đụng vào engine.** Phim đầu tiên chứng minh engine đã đủ.

---

## Nợ mang theo

| Nợ | Ảnh hưởng |
|---|---|
| Bản ANTT hiện tại dựng bằng `--allow-unapproved`; kịch bản còn câu cụt "công tác xây dựng" và vài cụm nhận dạng sai | Chưa giao được, dù phim đã render xong |
| Nhạc nền chưa rõ giấy phép, lại nằm ngoài `music/` nên `assertLicensedMusic` không thấy | Cần mở rộng guard, hoặc chọn nhạc có license |
| `videos tuyen truyen/Kịch bản phóng sự.md` là file 0 byte | Nguồn kịch bản thật đang nằm ở đâu đó ngoài repo |
