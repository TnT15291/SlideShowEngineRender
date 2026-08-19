import { useState } from "react"
import { ArrowRight, CheckCircle2, Clapperboard, Eye, EyeOff, Film, LogIn, Mail, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageToggle } from "@/components/LanguageToggle"
import { LegalLink, TermsAcceptance } from "@/components/TermsAcceptance"
import { apiMessage } from "@/lib/apiMessage"
import { apiPost } from "@/lib/api"
import { useI18n } from "@/lib/i18n"

type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>
  onRegister: (input: { username: string; password: string; email: string }) => Promise<void>
  onBrowseGallery: () => void
}

type Mode = "login" | "register" | "forgot"

export function LoginPage({ onLogin, onRegister, onBrowseGallery }: LoginPageProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<Mode>("login")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (mode === "forgot") return <ForgotPasswordCard onBack={() => { setMode("login"); setError(null) }} />

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (mode === "register") {
      if (password !== confirmPassword) {
        setError(t("login.passwordsDoNotMatch"))
        return
      }
      // The submit button is already disabled without it; this is the guard
      // for a form submitted by pressing Enter in a text field.
      if (!acceptedTerms) {
        setError(t("legal.mustAccept"))
        return
      }
    }
    setSubmitting(true)
    try {
      if (mode === "login") await onLogin(username, password)
      else await onRegister({ username: username.trim(), password, email: email.trim() })
    } catch (reason) {
      setError(apiMessage(reason, t, mode === "login" ? "login.unableToSignIn" : "login.unableToRegister"))
    } finally {
      setSubmitting(false)
    }
  }

  function toggleMode() {
    setMode(mode === "login" ? "register" : "login")
    setError(null)
    setConfirmPassword("")
    setAcceptedTerms(false)
    setShowPassword(false)
    setShowConfirmPassword(false)
  }

  const registering = mode === "register"
  return (
    <main className="login-canvas grid min-h-screen place-items-center bg-sidebar px-4 py-10 text-sidebar-foreground">
      <Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-background text-foreground shadow-2xl shadow-black/30">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
        {/* Sign-in is the first screen a customer sees and sits outside the app
            shell, so the language switch has to live here too — otherwise the
            only way to reach it would be behind the login itself. */}
        <div className="absolute right-4 top-4 z-10"><LanguageToggle /></div>
        <CardHeader className="items-center px-6 pb-7 pt-8 text-center sm:px-9">
          <div className="grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
            <Clapperboard className="size-6" />
          </div>
          {/* The only heading on the page, so it is the h1 rather than the
              CardTitle default of h3. */}
          <CardTitle as="h1" className="mt-4 font-serif text-3xl">StoReel</CardTitle>
          <CardDescription className="max-w-xs leading-6">
            {registering ? t("login.registerIntro") : t("login.welcome")}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-7 sm:px-9 sm:pb-9">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-sm font-medium">{t("login.username")}</label>
              <input
                id="username"
                autoFocus
                autoComplete="username"
                className="field mt-0 w-full"
                minLength={registering ? 3 : undefined}
                pattern={registering ? "[a-z0-9]+(?:-[a-z0-9]+)*" : undefined}
                aria-describedby={registering ? "username-hint" : undefined}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              {registering && <p id="username-hint" className="text-xs text-muted-foreground">{t("login.usernameHint")}</p>}
            </div>
            {/* Registration only. Sign-in stays username+password so the
                millions of muscle-memory logins already out there still work. */}
            {registering && <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium">{t("login.email")}</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="field mt-0 w-full"
                aria-describedby="email-hint"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <p id="email-hint" className="text-xs text-muted-foreground">{t("login.emailHint")}</p>
            </div>}
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium">{t("login.password")}</label>
              <span className="relative block">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={registering ? "new-password" : "current-password"}
                  className="field mt-0 w-full pr-10"
                  minLength={registering ? 8 : undefined}
                  aria-describedby={registering ? "password-hint" : undefined}
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
              {registering && <p id="password-hint" className="text-xs text-muted-foreground">{t("login.passwordHint")}</p>}
            </div>
            {registering && <div className="space-y-1.5">
              <label htmlFor="confirm-password" className="block text-sm font-medium">{t("login.confirmPassword")}</label>
              <span className="relative block">
                <input
                  id="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="field mt-0 w-full pr-10"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 z-10 grid w-10 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? t("login.hideConfirmPassword") : t("login.showConfirmPassword")}
                  aria-pressed={showConfirmPassword}
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </div>}
            {registering && <TermsAcceptance checked={acceptedTerms} onChange={setAcceptedTerms} disabled={submitting} idPrefix="register" />}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              size="lg"
              className="w-full shadow-sm"
              disabled={submitting || !username.trim() || !password || (registering && (!confirmPassword || !email.trim() || !acceptedTerms))}
            >
              {registering ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
              {submitting
                ? registering ? t("login.creatingAccount") : t("login.signingIn")
                : registering ? t("login.createAccount") : t("login.signIn")}
            </Button>
            {!registering && (
              <button
                type="button"
                onClick={() => { setMode("forgot"); setError(null) }}
                className="w-full text-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {t("reset.forgotLink")}
              </button>
            )}
            <Button type="button" variant="outline" className="w-full" disabled={submitting} onClick={toggleMode}>
              {registering ? t("login.toSignIn") : t("login.toRegister")}
            </Button>
            <div className="flex items-center gap-3 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              {t("login.or")}
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              onClick={onBrowseGallery}
              className="group flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2.5">
                <Film className="size-4 text-primary" />
                {t("login.browseGallery")}
              </span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </form>
          <LegalFooter />
        </CardContent>
      </Card>
    </main>
  )
}

/**
 * Step one of the reset: hand over an email address.
 *
 * The confirmation deliberately does not say whether an account was found —
 * the API answers identically either way, and copy that implied otherwise
 * would give away the distinction the endpoint is built to hide.
 */
function ForgotPasswordCard({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost("/auth/password/forgot", { email: email.trim() })
      setSent(true)
    } catch (reason) {
      setError(apiMessage(reason, t, "reset.unableToSend"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-canvas grid min-h-screen place-items-center bg-sidebar px-4 py-10 text-sidebar-foreground">
      <Card className="relative w-full max-w-md overflow-hidden border-white/10 bg-background text-foreground shadow-2xl shadow-black/30">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
        <div className="absolute right-4 top-4 z-10"><LanguageToggle /></div>
        <CardHeader className="items-center px-6 pb-7 pt-8 text-center sm:px-9">
          <div className={sent
            ? "grid size-14 place-items-center rounded-2xl bg-success/15 text-success-text"
            : "grid size-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25"}>
            {sent ? <CheckCircle2 className="size-6" /> : <Mail className="size-6" />}
          </div>
          <CardTitle as="h1" className="mt-4 font-serif text-2xl">{sent ? t("reset.sentTitle") : t("reset.forgotTitle")}</CardTitle>
          <CardDescription className="max-w-xs leading-6">{sent ? t("reset.sentDetail") : t("reset.forgotIntro")}</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-9 sm:px-9">
          {sent ? (
            <Button size="lg" className="w-full" onClick={onBack}>{t("reset.backToSignIn")}</Button>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <label htmlFor="forgot-email" className="block text-sm font-medium">{t("login.email")}</label>
                <input
                  id="forgot-email"
                  autoFocus
                  type="email"
                  required
                  autoComplete="email"
                  className="field mt-0 w-full"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={submitting || !email.trim()}>
                {submitting ? t("reset.sending") : t("reset.sendLink")}
              </Button>
              <Button type="button" variant="outline" className="w-full" disabled={submitting} onClick={onBack}>
                {t("reset.backToSignIn")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

/**
 * Both policies, linked from the one page every customer passes through.
 *
 * G2.2 asks for a footer link. The app shell has no footer — the sidebar runs
 * the full height — so the signed-out card is where a link reaches everyone,
 * including someone deciding whether to register at all.
 */
export function LegalFooter() {
  const { t } = useI18n()
  return (
    <p className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground">
      <LegalLink document="terms" label={t("legal.terms")} />
      <span className="px-2">·</span>
      <LegalLink document="privacy" label={t("legal.privacy")} />
    </p>
  )
}
