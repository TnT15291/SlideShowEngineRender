import { useState } from "react"
import { ArrowRight, Clapperboard, Eye, EyeOff, Film, LogIn, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageToggle } from "@/components/LanguageToggle"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n } from "@/lib/i18n"

type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>
  onRegister: (username: string, password: string) => Promise<void>
  onBrowseGallery: () => void
}

export function LoginPage({ onLogin, onRegister, onBrowseGallery }: LoginPageProps) {
  const { t } = useI18n()
  const [mode, setMode] = useState<"login" | "register">("login")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (mode === "register" && password !== confirmPassword) {
      setError(t("login.passwordsDoNotMatch"))
      return
    }
    setSubmitting(true)
    try {
      if (mode === "login") await onLogin(username, password)
      else await onRegister(username.trim(), password)
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
          <CardTitle className="mt-4 font-serif text-3xl">StoReel</CardTitle>
          <CardDescription className="max-w-xs leading-6">
            {registering ? t("login.registerIntro") : t("login.welcome")}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-7 sm:px-9 sm:pb-9">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1.5 text-sm font-medium">
              {t("login.username")}
              <input
                autoFocus
                autoComplete="username"
                className="field w-full"
                minLength={registering ? 3 : undefined}
                pattern={registering ? "[a-z0-9]+(?:-[a-z0-9]+)*" : undefined}
                title={registering ? t("login.usernameHint") : undefined}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              {t("login.password")}
              <span className="relative block">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete={registering ? "new-password" : "current-password"}
                  className="field w-full pr-10"
                  minLength={registering ? 8 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute bottom-0 right-0 top-2 z-10 grid w-10 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            {registering && <label className="block space-y-1.5 text-sm font-medium">
              {t("login.confirmPassword")}
              <span className="relative block">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="field w-full pr-10"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="absolute bottom-0 right-0 top-2 z-10 grid w-10 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
                  aria-label={showConfirmPassword ? t("login.hideConfirmPassword") : t("login.showConfirmPassword")}
                  aria-pressed={showConfirmPassword}
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full shadow-sm" disabled={submitting || !username.trim() || !password || (registering && !confirmPassword)}>
              {registering ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
              {submitting
                ? registering ? t("login.creatingAccount") : t("login.signingIn")
                : registering ? t("login.createAccount") : t("login.signIn")}
            </Button>
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
        </CardContent>
      </Card>
    </main>
  )
}
