import { useState } from "react"
import { Mail } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { TermsAcceptance } from "@/components/TermsAcceptance"
import { AuthShell } from "@/ResetPasswordPage"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n } from "@/lib/i18n"
import type { StudioUser } from "@/types"

/**
 * The G2.1 backfill gate.
 *
 * Accounts created before email was required cannot be reset and cannot be
 * contacted when their render fails — which is the exact situation the plan
 * calls "càng để lâu càng đắt". This blocks the workspace at the next sign-in
 * until the gap is closed, rather than nagging from a banner that a customer
 * can ignore for a year.
 *
 * Not a dismissable dialog on purpose: the only way past it is to supply what
 * is missing, or to sign out.
 */
export function AccountCompletionPage({ user, onSetEmail, onAcceptTerms, onSignOut }: {
  user: StudioUser
  onSetEmail: (email: string) => Promise<void>
  onAcceptTerms: () => Promise<void>
  onSignOut: () => void
}) {
  const { t } = useI18n()
  const needsEmail = !user.email
  const needsTerms = !user.termsAccepted
  const [email, setEmail] = useState("")
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (needsTerms && !accepted) {
      setError(t("legal.mustAccept"))
      return
    }
    setSubmitting(true)
    try {
      // Email first: it is the field that can fail (an address already in use),
      // and recording consent for an account that then bounced off a duplicate
      // would leave the two halves of this form disagreeing.
      if (needsEmail) await onSetEmail(email.trim())
      if (needsTerms) await onAcceptTerms()
    } catch (reason) {
      setError(apiMessage(reason, t, "account.unableToSave"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <CardHeader className="items-center px-6 pb-7 pt-8 text-center sm:px-9">
        <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
          <Mail className="size-6" />
        </div>
        <CardTitle as="h1" className="mt-4 font-serif text-2xl">{t("account.completeTitle")}</CardTitle>
        <CardDescription className="leading-6">
          {needsEmail ? t("account.completeIntro") : t("account.completeTermsOnly")}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-9 sm:px-9">
        <form className="space-y-4" onSubmit={handleSubmit}>
          {needsEmail && (
            <div className="space-y-1.5">
              <label htmlFor="backfill-email" className="block text-sm font-medium">{t("login.email")}</label>
              <input
                id="backfill-email"
                autoFocus
                type="email"
                required
                autoComplete="email"
                className="field mt-0 w-full"
                aria-describedby="backfill-email-hint"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p id="backfill-email-hint" className="text-xs text-muted-foreground">{t("login.emailHint")}</p>
            </div>
          )}
          {needsTerms && <TermsAcceptance checked={accepted} onChange={setAccepted} disabled={submitting} idPrefix="backfill" />}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={submitting || (needsEmail && !email.trim()) || (needsTerms && !accepted)}>
            {submitting ? t("common.saving") : t("account.save")}
          </Button>
          <Button type="button" variant="outline" className="w-full" disabled={submitting} onClick={onSignOut}>
            {t("account.signOutInstead")}
          </Button>
        </form>
      </CardContent>
    </AuthShell>
  )
}
