/**
 * The Terms of Service and Privacy Policy, in both languages.
 *
 * These are drafted from what the software actually does — the retention
 * windows below are the ones `scripts/purgeDeliveredProject.mjs` enforces, and
 * the music clause matches the warning shown at the upload step. Keep them in
 * step: a policy that promises something the pipeline does not do is worse
 * than no policy, because it is a written commitment you are already breaking.
 *
 * They are NOT reviewed by a lawyer. Before taking real money, have someone
 * qualified read them against Vietnamese consumer and personal-data law.
 *
 * Every business-specific fact lives in `businessDetails` so there is exactly
 * one place to edit. While any value there is still a placeholder, both pages
 * render a warning banner — see `unfilledBusinessDetails`.
 */

export const PLACEHOLDER_PREFIX = "TODO:"

/**
 * Fill these in before going live. Each value that still starts with
 * `TODO:` is reported on the page itself, so an unfinished policy cannot be
 * published quietly.
 */
export const businessDetails = {
  /** Registered trading name of the business that takes the money. */
  legalName: "TODO: tên doanh nghiệp / hộ kinh doanh",
  /** Business registration number, if the business is registered. */
  registrationNumber: "TODO: mã số thuế / số ĐKKD",
  /** Postal address customers can write to. */
  address: "TODO: địa chỉ liên hệ",
  /** The address that answers support, deletion, and refund requests. */
  contactEmail: "TODO: email hỗ trợ",
  /** Where disputes are settled. */
  jurisdiction: "TODO: toà án / tỉnh thành có thẩm quyền",
  /** Effective date shown at the top of both documents. */
  lastUpdated: "2026-08-10",
} as const

export type BusinessDetails = typeof businessDetails

export function unfilledBusinessDetails(details: BusinessDetails = businessDetails): string[] {
  return Object.entries(details)
    .filter(([, value]) => value.startsWith(PLACEHOLDER_PREFIX))
    .map(([key]) => key)
}

/** How long each class of customer data is kept. Stated once, referenced by both documents. */
export const retention = {
  /** Uploaded photos, music, and every intermediate render artefact. */
  sourceDays: 30,
  /** The delivered film, so a customer can download it again. */
  deliveryDays: 90,
  /** How long a deletion request takes to honour. */
  deletionDays: 30,
  /** Refund window after delivery. */
  refundDays: 7,
} as const

export type LegalSection = { heading: string; body: string[] }
export type LegalDocument = { title: string; intro: string; sections: LegalSection[] }
export type LegalDocuments = { terms: LegalDocument; privacy: LegalDocument }

export function legalDocuments(locale: "vi" | "en", details: BusinessDetails = businessDetails): LegalDocuments {
  return locale === "vi" ? vietnamese(details) : english(details)
}

function vietnamese(d: BusinessDetails): LegalDocuments {
  return {
    terms: {
      title: "Điều khoản sử dụng",
      intro: `Điều khoản này áp dụng cho dịch vụ dựng phim cưới StoReel do ${d.legalName} (${d.registrationNumber}), địa chỉ ${d.address}, cung cấp. Khi tạo tài khoản hoặc thanh toán, bạn đồng ý với các điều khoản dưới đây.`,
      sections: [
        {
          heading: "1. Dịch vụ",
          body: [
            "StoReel nhận ảnh và nhạc bạn tải lên, rồi dựng thành một phim ngắn theo phong cách bạn chọn.",
            "Mỗi phim được dựng bằng máy và có thể mất từ 15 đến 60 phút. Đơn hàng được xử lý lần lượt, nên thời gian chờ thực tế phụ thuộc vào số đơn đang xếp trước bạn.",
            "Chúng tôi không cam kết một kết quả nghệ thuật cụ thể. Bản xem trước và thư viện phong cách là mô tả trung thực nhất về thứ bạn sẽ nhận được.",
          ],
        },
        {
          heading: "2. Ảnh của bạn vẫn là của bạn",
          body: [
            "Bạn giữ toàn bộ quyền đối với ảnh và nhạc bạn tải lên. Chúng tôi không bán, không cấp phép lại, không dùng chúng để huấn luyện mô hình.",
            "Bạn cấp cho chúng tôi một quyền sử dụng giới hạn, chỉ nhằm mục đích lưu trữ và xử lý ảnh để dựng phim cho chính bạn.",
            "Chúng tôi chỉ đưa phim của bạn vào thư viện giới thiệu công khai khi bạn tự bấm chia sẻ. Mặc định là không chia sẻ.",
            "Phim thành phẩm thuộc về bạn. Bạn được dùng cho mục đích cá nhân và thương mại tuỳ ý, trong giới hạn quyền của chính bạn đối với ảnh và nhạc đã dùng.",
          ],
        },
        {
          heading: "3. Bản quyền âm nhạc — phần bạn chịu trách nhiệm",
          body: [
            "Bạn tự chọn và tự tải nhạc lên. Bạn chịu trách nhiệm về quyền sử dụng bản nhạc đó.",
            "Nhạc thương mại phổ biến gần như chắc chắn sẽ bị YouTube, Facebook hoặc TikTok nhận diện bản quyền. Hậu quả thường gặp là video bị tắt tiếng, bị chặn ở một số quốc gia, hoặc doanh thu bị chuyển cho chủ sở hữu bản quyền.",
            "Điều đó KHÔNG phải lỗi kỹ thuật của phim, và không thuộc phạm vi hoàn tiền. Chúng tôi cảnh báo bạn ngay tại bước tải nhạc lên, trước khi bạn trả tiền.",
            "Nếu bạn định đăng phim công khai, hãy dùng nhạc bạn đã có giấy phép hoặc nhạc miễn phí bản quyền.",
          ],
        },
        {
          heading: "4. Thanh toán và hoàn tiền",
          body: [
            "Giá hiển thị tại thời điểm đặt hàng là giá cuối cùng. Mỗi lần dựng phim thật tiêu tốn một lượt render đã mua.",
            "Nếu quá trình dựng thất bại do lỗi của chúng tôi và không tạo ra phim nào, lượt render được hoàn lại tự động vào tài khoản.",
            `Nếu phim giao ra bị lỗi kỹ thuật rõ ràng, hãy báo trong vòng ${retention.refundDays} ngày kể từ khi nhận. Chúng tôi sẽ dựng lại hoặc hoàn tiền lượt đó.`,
            "Không hoàn tiền vì lý do thẩm mỹ chủ quan, vì chất lượng ảnh gốc, hay vì khiếu nại bản quyền nhạc.",
          ],
        },
        {
          heading: "5. Nội dung bạn không được tải lên",
          body: [
            "Ảnh của người khác khi chưa được họ đồng ý.",
            "Nội dung khiêu dâm, bạo lực, hoặc vi phạm pháp luật Việt Nam.",
            "Tài khoản vi phạm sẽ bị khoá và dữ liệu bị xoá, không hoàn tiền.",
          ],
        },
        {
          heading: "6. Lưu trữ và xoá dữ liệu",
          body: [
            `Ảnh gốc và các file trung gian được xoá trong vòng ${retention.sourceDays} ngày sau khi giao phim.`,
            `Phim thành phẩm được giữ ${retention.deliveryDays} ngày để bạn tải lại, sau đó bị xoá.`,
            "Hãy tải phim về và tự lưu một bản. Chúng tôi không phải nơi lưu trữ lâu dài.",
            "Chi tiết xem tại Chính sách bảo mật.",
          ],
        },
        {
          heading: "7. Giới hạn trách nhiệm",
          body: [
            "Chúng tôi cố gắng giữ an toàn dữ liệu của bạn, nhưng không cam kết dịch vụ không bao giờ gián đoạn hay không bao giờ mất dữ liệu.",
            "Trách nhiệm tối đa của chúng tôi trong mọi trường hợp không vượt quá số tiền bạn đã trả cho đơn hàng liên quan.",
            "Đây là lý do điều 6 nói rõ: hãy tự giữ một bản sao ảnh gốc và phim thành phẩm.",
          ],
        },
        {
          heading: "8. Thay đổi điều khoản",
          body: [
            "Khi có thay đổi đáng kể, chúng tôi sẽ báo qua email đăng ký của bạn trước khi áp dụng.",
            "Tiếp tục sử dụng dịch vụ sau ngày áp dụng nghĩa là bạn chấp nhận bản mới.",
          ],
        },
        {
          heading: "9. Liên hệ và giải quyết tranh chấp",
          body: [
            `Mọi yêu cầu hỗ trợ, xoá dữ liệu hoặc hoàn tiền: ${d.contactEmail}.`,
            `Tranh chấp không tự giải quyết được sẽ do ${d.jurisdiction} giải quyết theo pháp luật Việt Nam.`,
          ],
        },
      ],
    },
    privacy: {
      title: "Chính sách bảo mật",
      intro: `Chính sách này mô tả ${d.legalName} thu thập, sử dụng và xoá dữ liệu cá nhân của bạn như thế nào khi bạn dùng StoReel.`,
      sections: [
        {
          heading: "1. Dữ liệu chúng tôi thu thập",
          body: [
            "Tên đăng nhập, địa chỉ email và mật khẩu đã băm (chúng tôi không bao giờ lưu mật khẩu dạng đọc được).",
            "Ảnh và nhạc bạn tải lên, cùng tên dự án và các lựa chọn phong cách.",
            "Ảnh cưới chứa hình ảnh nhân thân của bạn và của khách mời. Chúng tôi coi đây là dữ liệu cá nhân nhạy cảm và xử lý tương ứng.",
            "Nhật ký kỹ thuật của tiến trình dựng phim, dùng để tìm nguyên nhân khi có lỗi.",
            "Chúng tôi KHÔNG dùng cookie theo dõi và KHÔNG gắn mã quảng cáo của bên thứ ba.",
          ],
        },
        {
          heading: "2. Chúng tôi dùng dữ liệu để làm gì",
          body: [
            "Dựng phim bạn đặt — đây là mục đích chính và gần như là duy nhất.",
            "Liên hệ với bạn khi đơn hàng gặp sự cố, hoặc khi bạn yêu cầu đặt lại mật khẩu.",
            "Chúng tôi không gửi email quảng cáo và không bán dữ liệu cho bất kỳ ai.",
          ],
        },
        {
          heading: "3. Phân tích ảnh bằng máy",
          body: [
            "Hệ thống tự động dò khuôn mặt trong ảnh để tránh cắt mất mặt người khi dựng khung hình. Việc này chạy trên máy chủ của chúng tôi.",
            "Với một số gói cao cấp, ảnh có thể được gửi tới nhà cung cấp mô hình thị giác bên thứ ba để mô tả nội dung ảnh. Chúng tôi sẽ nói rõ trước khi bạn chọn gói đó.",
            "Chúng tôi không dùng ảnh của bạn để huấn luyện bất kỳ mô hình nào.",
          ],
        },
        {
          heading: "4. Chúng tôi chia sẻ dữ liệu với ai",
          body: [
            "Cổng thanh toán (Stripe, MoMo) — chỉ nhận thông tin cần cho giao dịch. Chúng tôi không nhìn thấy và không lưu số thẻ của bạn.",
            "Nhà cung cấp email giao dịch (Resend) — chỉ nhận địa chỉ email và nội dung thư đặt lại mật khẩu hoặc thông báo sự cố.",
            "Cơ quan nhà nước, khi có yêu cầu hợp pháp bằng văn bản.",
            "Ngoài ba trường hợp trên, không ai khác.",
          ],
        },
        {
          heading: "5. Lưu trữ và bảo mật",
          body: [
            "Dữ liệu được lưu trên máy chủ do chúng tôi vận hành, có sao lưu định kỳ ra nơi khác.",
            "Truy cập web luôn qua HTTPS. Mật khẩu được băm bằng scrypt kèm salt riêng cho từng tài khoản.",
            "Chỉ quản trị viên của chúng tôi mới truy cập được ảnh của bạn, và chỉ khi cần xử lý đơn hàng hoặc khắc phục sự cố.",
          ],
        },
        {
          heading: "6. Thời gian lưu và cách xoá",
          body: [
            `Ảnh gốc, nhạc và file trung gian: xoá trong vòng ${retention.sourceDays} ngày sau khi giao phim.`,
            `Phim thành phẩm: giữ ${retention.deliveryDays} ngày kể từ khi giao, sau đó xoá.`,
            "Tài khoản và email: giữ đến khi bạn yêu cầu xoá.",
            `Bạn có quyền yêu cầu xem, sửa hoặc xoá dữ liệu của mình bất cứ lúc nào bằng cách gửi email tới ${d.contactEmail}. Chúng tôi xử lý trong vòng ${retention.deletionDays} ngày.`,
            "Bạn cũng có thể tự xoá một dự án trong ứng dụng; thao tác này xoá ảnh của dự án đó ngay.",
          ],
        },
        {
          heading: "7. Trẻ em",
          body: [
            "Dịch vụ này dành cho người từ 18 tuổi trở lên. Chúng tôi không cố ý thu thập dữ liệu của trẻ em với tư cách người dùng.",
            "Ảnh cưới có thể có mặt trẻ em với tư cách khách mời; trách nhiệm xin phép cha mẹ các em thuộc về bạn.",
          ],
        },
        {
          heading: "8. Liên hệ",
          body: [
            `Mọi câu hỏi về dữ liệu cá nhân: ${d.contactEmail}, hoặc gửi thư tới ${d.address}.`,
          ],
        },
      ],
    },
  }
}

function english(d: BusinessDetails): LegalDocuments {
  return {
    terms: {
      title: "Terms of Service",
      intro: `These terms cover the StoReel wedding film service operated by ${d.legalName} (${d.registrationNumber}), ${d.address}. By creating an account or paying for a film, you agree to them.`,
      sections: [
        {
          heading: "1. The service",
          body: [
            "StoReel takes the photos and music you upload and assembles them into a short film in a style you choose.",
            "Each film is rendered by machine and takes roughly 15 to 60 minutes. Orders are processed one at a time, so your actual wait depends on how many orders are ahead of yours.",
            "We do not promise a particular artistic result. The previews and the style library are the most honest description of what you will get.",
          ],
        },
        {
          heading: "2. Your photos stay yours",
          body: [
            "You keep every right to the photos and music you upload. We do not sell them, sub-license them, or use them to train models.",
            "You grant us a limited licence to store and process them for the sole purpose of making your film.",
            "Your film appears in the public showcase gallery only if you press share yourself. The default is private.",
            "The finished film is yours, for personal and commercial use alike, within whatever rights you hold in the photos and music that went into it.",
          ],
        },
        {
          heading: "3. Music copyright is your responsibility",
          body: [
            "You choose and upload the music. The right to use that recording is yours to hold.",
            "Well-known commercial music will almost certainly be matched by YouTube, Facebook, or TikTok. The usual outcomes are a muted video, a block in some countries, or the ad revenue being redirected to the rights holder.",
            "That is not a technical fault in the film and is not covered by the refund policy. We warn you at the music upload step, before you pay.",
            "If you intend to post the film publicly, use music you have licensed or music that is royalty-free.",
          ],
        },
        {
          heading: "4. Payment and refunds",
          body: [
            "The price shown at checkout is the final price. Each real render consumes one purchased render credit.",
            "If a render fails through a fault of ours and produces no film, the credit is returned to your account automatically.",
            `If a delivered film has a clear technical defect, tell us within ${retention.refundDays} days of delivery. We will re-render it or refund that credit.`,
            "We do not refund for subjective taste, for the quality of the source photos, or for a music copyright claim.",
          ],
        },
        {
          heading: "5. What you may not upload",
          body: [
            "Photos of other people without their consent.",
            "Sexual, violent, or otherwise unlawful content.",
            "Accounts that break this rule are closed and their data deleted, without a refund.",
          ],
        },
        {
          heading: "6. Storage and deletion",
          body: [
            `Source photos and intermediate files are deleted within ${retention.sourceDays} days of delivery.`,
            `The finished film is kept for ${retention.deliveryDays} days so you can download it again, then deleted.`,
            "Download your film and keep your own copy. We are not long-term storage.",
            "Full detail is in the Privacy Policy.",
          ],
        },
        {
          heading: "7. Limitation of liability",
          body: [
            "We work to keep your data safe, but we do not promise the service will never be interrupted and never lose data.",
            "Our total liability in any circumstance is capped at what you paid for the order in question.",
            "That cap is exactly why section 6 says it plainly: keep your own copy of both your source photos and your finished film.",
          ],
        },
        {
          heading: "8. Changes to these terms",
          body: [
            "We will email the address on your account before any material change takes effect.",
            "Continuing to use the service after that date means you accept the new version.",
          ],
        },
        {
          heading: "9. Contact and disputes",
          body: [
            `Support, deletion, and refund requests: ${d.contactEmail}.`,
            `Disputes we cannot settle between us go to ${d.jurisdiction} under the law of Vietnam.`,
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      intro: `This policy describes how ${d.legalName} collects, uses, and deletes your personal data when you use StoReel.`,
      sections: [
        {
          heading: "1. What we collect",
          body: [
            "Your username, email address, and a hashed password — we never store a readable password.",
            "The photos and music you upload, plus your project name and style choices.",
            "Wedding photos contain your likeness and your guests'. We treat them as sensitive personal data and handle them accordingly.",
            "Technical logs of the render, used to find the cause when something fails.",
            "We use NO tracking cookies and NO third-party advertising tags.",
          ],
        },
        {
          heading: "2. What we use it for",
          body: [
            "Making the film you ordered — the primary and very nearly the only purpose.",
            "Reaching you when an order runs into trouble, or when you ask to reset your password.",
            "We send no marketing email and sell your data to nobody.",
          ],
        },
        {
          heading: "3. Automated photo analysis",
          body: [
            "The system detects faces so that framing does not crop someone's face off. This runs on our own server.",
            "On some premium tiers, photos may be sent to a third-party vision model provider to describe their content. We say so before you choose that tier.",
            "We do not use your photos to train any model.",
          ],
        },
        {
          heading: "4. Who else sees it",
          body: [
            "Payment providers (Stripe, MoMo) receive only what the transaction needs. We never see or store your card number.",
            "Our transactional email provider (Resend) receives your email address and the text of password-reset or incident messages.",
            "Government authorities, on a lawful written request.",
            "Nobody else.",
          ],
        },
        {
          heading: "5. Storage and security",
          body: [
            "Data lives on servers we operate, backed up regularly to a separate location.",
            "The web app is served over HTTPS only. Passwords are hashed with scrypt and a per-account salt.",
            "Only our administrators can reach your photos, and only to process an order or fix a fault.",
          ],
        },
        {
          heading: "6. How long we keep it, and how to have it deleted",
          body: [
            `Source photos, music, and intermediate files: deleted within ${retention.sourceDays} days of delivery.`,
            `Finished films: kept ${retention.deliveryDays} days from delivery, then deleted.`,
            "Account and email address: kept until you ask us to delete them.",
            `You may ask to see, correct, or delete your data at any time by emailing ${d.contactEmail}. We act within ${retention.deletionDays} days.`,
            "You can also delete a project yourself in the app, which removes that project's photos immediately.",
          ],
        },
        {
          heading: "7. Children",
          body: [
            "This service is for people aged 18 and over. We do not knowingly collect data about children as users.",
            "Wedding photos may include children as guests; obtaining their parents' permission is your responsibility.",
          ],
        },
        {
          heading: "8. Contact",
          body: [
            `Questions about personal data: ${d.contactEmail}, or write to ${d.address}.`,
          ],
        },
      ],
    },
  }
}
