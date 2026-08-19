import { useState } from "react"
import { CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageToggle } from "@/components/LanguageToggle"
import { apiMessage } from "@/lib/apiMessage"
import { apiPost } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

/**
 * The page the password-reset email links to (`/?view=reset-password&token=…`).
 *
 * Rendered ahead of the auth gate in `App`, because the whole point is that
 * the person opening it cannot sign in. The token travels in the query string
 * and is spent by the POST below; after that it is dead, so the success state
 * sends them to sign in rather than logging them in automatically — that also
 * proves the new password works before they close the tab.
 */
export function ResetPasswordPage({ token, onDone }: { token: string | null; onDone: () => void }) {
  const { t } = useI18n()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirmPassword) {
      setError(t("login.passwordsDoNotMatch"))
      return
    }
    setSubmitting(true)
    try {
      await apiPost("/auth/password/reset", { token, newPassword: password })
      setDone(true)
    } catch (reason) {
      setError(apiMessage(reason, t, "reset.unableToReset"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      {done ? (
        <>
          <CardHeader className="items-center px-6 pb-7 pt-8 text-center sm:px-9">
            <div className="grid size-14 place-items-center rounded-2xl bg-success/15 text-success-text"><CheckCircle2 className="size-6" /></div>
            <CardTitle as="h1" className="mt-4 font-serif text-2xl">{t("reset.doneTitle")}</CardTitle>
            <CardDescription className="max-w-xs leading-6">{t("reset.doneDetail")}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-9 sm:px-9">
            <Button size="lg" className="w-full" onClick={onDone}>{t("reset.backToSignIn")}</Button>
          </CardContent>
        </>
      ) : (
        <>
          <CardHeader className="items-center px-6 pb-7 pt-8 text-center sm:px-9">
            <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"><KeyRound className="size-6" /></div>
            <CardTitle as="h1" className="mt-4 font-serif text-2xl">{t("reset.title")}</CardTitle>
            <CardDescription className="max-w-xs leading-6">{t("reset.intro")}</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-7 sm:px-9 sm:pb-9">
            {/* A link that lost its token can never succeed, so say so up front
                instead of letting them type a password and fail on submit. */}
            {!token ? (
              <div className="space-y-4">
                <p className="text-sm text-destructive">{t("reset.missingToken")}</p>
                <Button variant="outline" className="w-full" onClick={onDone}>{t("reset.backToSignIn")}</Button>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <label htmlFor="new-password" className="block text-sm font-medium">{t("reset.newPassword")}</label>
                  <span className="relative block">
                    <input
                      id="new-password"
                      autoFocus
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      className="field mt-0 w-full pr-10"
                      minLength={8}
                      aria-describedby="new-password-hint"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 z-10 grid w-10 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((visible) => !visible)}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </span>
                  <p id="new-password-hint" className="text-xs text-muted-foreground">{t("login.passwordHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="confirm-new-password" className="block text-sm font-medium">{t("reset.confirmNewPassword")}</label>
                  <input
                    id="confirm-new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    className="field mt-0 w-full"
                    minLength={8}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button type="submit" size="lg" className="w-full" disabled={submitting || !password || !confirmPassword}>
                  {submitting ? t("reset.submitting") : t("reset.submit")}
                </Button>
                <Button type="button" variant="outline" className="w-full" disabled={submitting} onClick={onDone}>
                  {t("reset.backToSignIn")}
                </Button>
              </form>
            )}
          </CardContent>
        </>
      )}
    </AuthShell>
  )
}

/** The signed-out card frame, matching LoginPage so the flow doesn't jump. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="login-canvas grid min-h-screen place-items-center bg-sidebar px-4 py-10 text-sidebar-foreground">
      <Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-background text-foreground shadow-2xl shadow-black/30">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
        <div className="absolute right-4 top-4 z-10"><LanguageToggle /></div>
        {children}
      </Card>
    </main>
  )
}
