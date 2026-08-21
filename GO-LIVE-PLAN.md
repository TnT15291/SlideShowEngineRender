# Kế hoạch đưa StoReel ra bán

> Lập ngày 2026-08-10, dựa trên audit code thật (không đọc doc cũ).
>
> Đặt ở thư mục gốc chứ không phải `docs/` — theo đúng lệ đã có trong repo: `scripts/checkDocs.mjs`
> chỉ quét `docs/` và báo lỗi với mọi tên file chưa tồn tại, mà tài liệu này cố ý nhắc tới các file
> sẽ được tạo ở Giai đoạn 2.

---

## 0. Kết luận audit

Câu hỏi: *"Sản phẩm này đủ để mở web public bán theo video chưa?"*

Trả lời: **hai câu hỏi khác nhau, hai đáp án khác nhau.**

| Hình thức bán | Trạng thái |
|---|---|
| **Nhận ảnh → tự render → giao file** (anh là người vận hành) | ✅ **Bán được ngay hôm nay** |
| **Web public tự phục vụ** (khách tự đăng ký, trả tiền, render) | ❌ **Chưa** — 6 điểm chặn cứng ở §2 |

### Bằng chứng đo được (2026-08-10)

| Chỉ số | Giá trị | Nguồn |
|---|---|---|
| Recipe đã verified | 25 | `story-templates/*.json` |
| `npm run test:unit` | 520/520 pass | chạy trên cây sạch |
| Dự án cưới thật đã render xong | ~20 | `projects/` |
| Thời gian render 1 video | **924s – 2912s** (15–48 phút) | job manifest của 5 job thật |
| Dung lượng đĩa | **41 GB / 58 dự án** ≈ 700 MB/dự án | `du -sh projects` |
| Trần concurrency render | **không có** | `server/services/projectOperations.ts` chỉ khoá theo từng project |
| File ToS / Privacy | **0** | grep toàn bộ `apps/web/src` |
| Luồng email / reset password | **0** | `server/services/auth.ts` chỉ có username + password |

---

## 1. Giai đoạn 1 — Bán thủ công, 0 dòng code

**Mục tiêu: kiểm chứng giá và nhu cầu TRƯỚC khi đổ công vào hạ tầng.** Nếu không ai mua ở mức giá
anh định, thì toàn bộ Giai đoạn 2 là công vô ích. Đây là lý do giai đoạn này đứng trước.

| # | Việc | Nghiệm thu |
|---|---|---|
| G1.1 | Dựng portfolio từ ~20 phim đã render trong `projects/` — chọn 3–5 phim đẹp nhất, mỗi phim 1 bản full + 1 bản cắt 30s cho TikTok/Reels | Có link xem được, không cần đăng nhập |
| G1.2 | Chốt **giá thật**. Số hiện tại (`MOMO_PER_VIDEO_PRICE_VND=390000`, `$15/video`, `$29/tháng`) đều là placeholder chưa ai quyết | Một bảng giá viết ra được, có tính tới 15–48 phút CPU/video |
| G1.3 | Quy trình nhận đơn: khách gửi ảnh qua Drive/Zalo → `npm run project:create` → `npm run template` → giao file | Chạy trọn 1 đơn thật từ đầu đến cuối, tính được thời gian công |
| G1.4 | **Kỷ luật lưu trữ**: xoá `temp/scene-cache/` và ảnh gốc sau khi giao. 700 MB/dự án nghĩa là ổ D: đầy trước khi bán được ~50 video | Có script hoặc checklist dọn, chạy sau mỗi lần giao |
| G1.5 | Cảnh báo bản quyền nhạc bằng văn bản khi nhận đơn (xem G2.7) | Câu chữ có sẵn để gửi khách |

**Ra khỏi giai đoạn 1 khi:** bán được ít nhất 5 video, và biết được giá nào khách chịu trả.

---

## 2. Giai đoạn 2 — Web bán nửa tự phục vụ

Khách đăng ký, upload, trả tiền trên web. **Render vẫn do anh bấm** — `JobRunnerPanel.tsx` và admin
incident center đã có sẵn. Cách này bỏ được điểm chặn nặng nhất (hàng đợi render) mà vẫn thu tiền tự động.

Thứ tự dưới đây là thứ tự **bắt buộc**, không phải danh sách ưu tiên: G2.1 càng để lâu càng đắt vì
mọi tài khoản đã tạo đều thiếu email.

### G2.1 — Email + đặt lại mật khẩu  ⟵ *làm trước tiên*

**Vấn đề:** `registerInputSchema` trong `server/services/auth.ts` chỉ nhận `username` + `password`.
Không có email nghĩa là: khách quên mật khẩu là mất tài khoản đã trả tiền, và **anh không có cách nào
liên hệ khi job lỗi** — mà job lỗi là chuyện có thật, `failureCause.ts` sinh ra chính vì thế.

**Việc:**
- Thêm `email` vào `userSchema` (optional để tài khoản cũ còn parse được — đúng lệ `plan` đang dùng).
- Luồng quên mật khẩu: token dùng một lần, có hạn, hash trước khi lưu (theo đúng cách `sessionSchema` đang làm).
- Gửi mail qua Resend — `RESEND_API_KEY` đã có sẵn trong `.env.example` cho incident alert, dùng lại.
- Backfill: bắt tài khoản cũ nhập email ở lần đăng nhập kế tiếp.

**Nghiệm thu:** đăng ký → nhận mail → quên mật khẩu → đặt lại → đăng nhập được, trên tài khoản sạch;
token đã dùng không dùng lại được; token hết hạn bị từ chối.

### G2.2 — Điều khoản sử dụng + Chính sách bảo mật

**Vấn đề:** 0 file. Anh lưu ảnh cưới người thật (dữ liệu cá nhân, hình ảnh nhân thân) và thu tiền.
Stripe/MoMo đều đòi hai trang này khi onboard merchant, nên đây cũng là điều kiện của G2.5.

**Việc:** hai trang tĩnh trong `apps/web`, link ở footer + checkbox lúc đăng ký. Nội dung tối thiểu:
ai sở hữu ảnh, giữ ảnh bao lâu, xoá thế nào, ai chịu trách nhiệm bản quyền nhạc (G2.7), hoàn tiền ra sao.

**Nghiệm thu:** hai trang mở được khi chưa đăng nhập; không đăng ký được nếu chưa tick.

### G2.3 — Deploy + HTTPS

**Vấn đề:** không có `Dockerfile`, không có deploy config. `server/config.ts` bind `127.0.0.1`.
Đây đang là app localhost.

**Việc:** Dockerfile (kèm ffmpeg + font trong image), reverse proxy có TLS, process manager tự khởi động lại,
biến môi trường production. Session token đang nằm trong `localStorage` — chấp nhận được, **với điều kiện
HTTPS là bắt buộc**, không có đường HTTP.

**Nghiệm thu:** truy cập được qua tên miền thật bằng HTTPS; kill process → tự sống lại; reboot máy → tự chạy.

### G2.4 — Sao lưu

**Vấn đề:** `server/data/studio-users.json`, `studio-sessions.json`, `incidents.sqlite` và toàn bộ ảnh
khách trong `projects/` nằm trên **một ổ đĩa, không backup, không replica**. Máy hỏng = mất ảnh cưới
của khách. Đây là loại mất mát không xin lỗi được.

**Việc:** backup tự động hằng ngày ra nơi khác máy, cho cả tài khoản lẫn ảnh; **và thử phục hồi một lần**.

**Nghiệm thu:** phục hồi thành công từ bản backup lên một máy trắng. Backup chưa từng restore không phải backup.

### G2.5 — Giá thật + key thanh toán live

**Vấn đề:** `STRIPE_SECRET_KEY` rỗng → `/api/billing/*` trả 409 `STRIPE_NOT_CONFIGURED`.
`MOMO_ENDPOINT` còn trỏ `test-payment.momo.vn`. Giá là placeholder.

**Việc:** onboard merchant (cần G2.2), nạp key live, đổi endpoint MoMo, đặt giá đã chốt ở G1.2.
`MOMO_IPN_URL` phải là HTTPS công khai — phụ thuộc G2.3.

**Nghiệm thu:** một giao dịch thật, tiền vào tài khoản, credit cộng đúng, IPN gửi lại 2 lần vẫn chỉ cộng 1 lần
(`processedPaymentIds` đã lo phần này — cần chứng minh trên môi trường live, không phải sandbox).

### G2.6 — Trần render đồng thời

**Vấn đề:** `projectOperations.ts` chỉ khoá **theo từng project**. 5 khách bấm render cùng lúc = 5 tiến trình
ffmpeg trên 1 PC Windows, mỗi cái 15–48 phút → cả 5 cùng treo.

**Việc:** ở mô hình nửa tự phục vụ, đơn giản nhất là **trần = 1**: khách đặt hàng vào hàng đợi, anh chạy lần lượt.
Cần một trần toàn cục thật trong code, và UI nói rõ "đang xếp hàng, còn N đơn trước".

**Nghiệm thu:** bấm render 5 job cùng lúc → đúng 1 job chạy, 4 job hiện trạng thái chờ, không job nào lỗi.

### G2.7 — Bản quyền nhạc

**Vấn đề:** engine bắt khách tự upload nhạc, nên rủi ro về nguyên tắc thuộc về khách — nhưng anh là bên
lưu trữ và phân phối. `music/` hiện chỉ có `Perfect.mp3` và `River Flows In You.mp3`: nhạc thương mại,
dùng để test thì được, **lọt vào bản giao cho khách là ăn claim**.

**Việc:** (a) ToS đẩy trách nhiệm bản quyền về phía khách + cảnh báo ngay tại bước upload nhạc rằng video
có thể bị claim nếu đăng YouTube/Facebook; hoặc (b) mua license một thư viện nhạc và cho khách chọn trong đó.
(b) đắt hơn nhưng bán được giá cao hơn.

**Nghiệm thu:** không có file nhạc thương mại nào nằm trong đường đi của bản giao; khách thấy cảnh báo trước khi trả tiền.

---

## 3. Giai đoạn 3 — Full self-serve

Chỉ làm khi Giai đoạn 2 đã có doanh thu đều.

- **Tách worker khỏi web**: render chạy ở tiến trình/máy riêng, web chỉ nhận đơn. Đây là điều kiện để
  nhiều khách render song song mà không giết nhau.
- **Object storage** (S3/R2) thay ổ đĩa cục bộ. 100 khách/tháng ≈ +70 GB/tháng.
- **Retention policy**: tự xoá ảnh gốc sau N ngày kể từ khi giao — vừa là chi phí, vừa là cam kết ở G2.2.
- **Smoke test Premium với key thật**: theo `docs/current-state.md`, tier Premium mới chạy end-to-end
  bằng STUB. **Đừng bán gói Premium trước khi việc này xong.**

---

## 4. Nợ kỹ thuật mang theo

Ghi lại ở đây để không mất khi dọn các tracker đã đóng:

| Nợ | Nguồn | Ảnh hưởng việc bán |
|---|---|---|
| ~~`duplicate_caption` trên repeat variant, 5 recipe~~ | ✅ Đo lại 2026-08-19: bốn ca cũ là echo mở/kết có chủ ý; ca thật còn lại ở `white-weddings-full-01` đã đổi copy và canary còn 0 `duplicate_caption` | Đã đóng |
| Lite còn Phase 6–7; P1 còn render smoke 2 profile, P2 còn canary | `docs/LITE-QUALITY-STABILITY-PROGRESS.md` | Nhẹ nếu chỉ bán tier template |
| Premium còn Hướng B (Phase 3); P2 hoãn có lý do | `docs/PREMIUM-QUALITY-STABILITY-PROGRESS.md` | Chặn việc bán gói Premium |
| `test:api` còn 1 test job-runner chập chờn | — | Nhẹ, nhưng đừng để nó che một lỗi thật |
| Sắp xếp lại thứ tự ảnh chưa có endpoint | `docs/UI-UX-ASSESSMENT-2026-08.md` §"Deliberately not done" | Nhẹ — UI vẫn hứa "giữ thứ tự upload" |

---

## 5. Cố ý không làm

- **Không tối ưu thời gian render trước khi bán được hàng.** 15–48 phút/video là đắt, nhưng ở mô hình
  thủ công và nửa tự phục vụ thì nó không chặn ai. Tối ưu sớm là tối ưu cho một lượng khách chưa tồn tại.
- **Không dựng hàng đợi phân tán ở Giai đoạn 2.** Trần = 1 giải quyết đúng vấn đề với 1% công sức.
- **Không đụng vào engine.** Engine là phần chín nhất của sản phẩm; mọi điểm chặn ở trên đều nằm ngoài nó.
