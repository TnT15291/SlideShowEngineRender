/**
 * Transactional email, over Resend.
 *
 * The repo already talks to Resend from `scripts/lib/incidents.mjs` for
 * operator alerts. This is the customer-facing half of the same account: it
 * reuses `RESEND_API_KEY` but takes its own `STOREEL_MAIL_FROM`, because the
 * address a couple sees on a password-reset mail should not be the internal
 * alerts sender.
 *
 * Unconfigured is a first-class state, handled the way billing already handles
 * a missing Stripe key: the route returns 409 EMAIL_NOT_CONFIGURED rather than
 * pretending to send. A "check your inbox" screen in front of mail that will
 * never arrive is worse than an honest error, because the customer stops
 * looking for another way in.
 */

export class EmailRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export type EmailConfig = { apiKey: string; from: string; publicUrl: string }

/**
 * Read mail configuration out of the environment, or `null` when it is absent.
 *
 * Read per call rather than cached at import time so a test — and an operator
 * editing .env — sees the change without a restart, matching how
 * `isAdminUsername` treats STOREEL_ADMIN_USERNAMES.
 */
export function emailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.STOREEL_MAIL_FROM?.trim()
  // The reset link has to be absolute — it is opened from a mail client, not
  // from a page that could resolve a relative path. Without a public URL there
  // is nothing to point the customer at, so mail counts as unconfigured.
  const publicUrl = process.env.STOREEL_PUBLIC_URL?.trim().replace(/\/+$/, "")
  if (!apiKey || !from || !publicUrl) return null
  return { apiKey, from, publicUrl }
}

export function requireEmailConfig(): EmailConfig {
  const config = emailConfig()
  if (!config) {
    throw new EmailRequestError(409, "EMAIL_NOT_CONFIGURED",
      "Email delivery is not configured — set RESEND_API_KEY, STOREEL_MAIL_FROM and STOREEL_PUBLIC_URL")
  }
  return config
}

type SendInput = { to: string; subject: string; text: string; config?: EmailConfig }

export async function sendEmail({ to, subject, text, config }: SendInput): Promise<void> {
  const resolved = config ?? requireEmailConfig()
  let response: Response
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resolved.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: resolved.from, to: [to], subject, text }),
    })
  } catch (error) {
    throw new EmailRequestError(502, "EMAIL_SEND_FAILED", `Could not reach the email provider: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    // Resend echoes the submitted address in its error body; the body is
    // logged by the caller's error path, so keep it short and unquoted.
    throw new EmailRequestError(502, "EMAIL_SEND_FAILED", `The email provider rejected the message (HTTP ${response.status})`)
  }
}

export function passwordResetUrl(config: EmailConfig, token: string): string {
  return `${config.publicUrl}/?view=reset-password&token=${encodeURIComponent(token)}`
}

/**
 * Bilingual on purpose. The app ships Vietnamese and English side by side and
 * mail is sent outside any request that knows which one this customer reads,
 * so guessing would be wrong half the time for the price of six extra lines.
 */
export async function sendPasswordResetEmail(input: { to: string; username: string; token: string; config?: EmailConfig }): Promise<void> {
  const config = input.config ?? requireEmailConfig()
  const url = passwordResetUrl(config, input.token)
  const text = [
    `Chào ${input.username},`,
    "",
    "Bạn (hoặc ai đó) đã yêu cầu đặt lại mật khẩu StoReel. Mở liên kết dưới đây để đặt mật khẩu mới:",
    url,
    "",
    "Liên kết chỉ dùng được MỘT lần và hết hạn sau 1 giờ.",
    "Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.",
    "",
    "———",
    "",
    `Hi ${input.username},`,
    "",
    "Someone asked to reset the password on your StoReel account. Open the link below to choose a new one:",
    url,
    "",
    "The link works ONCE and expires in 1 hour.",
    "If this wasn't you, ignore this email — your current password still works.",
  ].join("\n")
  await sendEmail({ to: input.to, subject: "StoReel · Đặt lại mật khẩu / Reset your password", text, config })
}
