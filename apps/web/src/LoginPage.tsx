import { useState } from "react"
import { Clapperboard, Eye, EyeOff, LogIn, UserPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ApiError } from "@/lib/api"

type LoginPageProps = {
  onLogin: (username: string, password: string) => Promise<void>
  onRegister: (username: string, password: string) => Promise<void>
  onBrowseGallery: () => void
}

export function LoginPage({ onLogin, onRegister, onBrowseGallery }: LoginPageProps) {
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
      setError("Passwords do not match")
      return
    }
    setSubmitting(true)
    try {
      if (mode === "login") await onLogin(username, password)
      else await onRegister(username.trim(), password)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : mode === "login" ? "Unable to sign in" : "Unable to create account")
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
    <main className="grid min-h-screen place-items-center bg-sidebar px-4 text-sidebar-foreground">
      <Card className="w-full max-w-sm border-white/10 bg-background text-foreground shadow-2xl">
        <CardHeader className="items-center text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Clapperboard className="size-6" />
          </div>
          <CardTitle className="mt-3 font-serif text-2xl">StoReel</CardTitle>
          <CardDescription>{registering ? "Create your StoReel account." : "Sign in to your account."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-1.5 text-sm font-medium">
              Username
              <input
                autoFocus
                autoComplete="username"
                className="field w-full"
                minLength={registering ? 3 : undefined}
                pattern={registering ? "[a-z0-9]+(?:-[a-z0-9]+)*" : undefined}
                title={registering ? "Use lowercase letters, numbers, or hyphens" : undefined}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              Password
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>
            {registering && <label className="block space-y-1.5 text-sm font-medium">
              Confirm password
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
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                  aria-pressed={showConfirmPassword}
                  onClick={() => setShowConfirmPassword((visible) => !visible)}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </span>
            </label>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={submitting || !username.trim() || !password || (registering && !confirmPassword)}>
              {registering ? <UserPlus className="size-4" /> : <LogIn className="size-4" />}
              {submitting ? registering ? "Creating account…" : "Signing in…" : registering ? "Create account" : "Sign in"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" disabled={submitting} onClick={toggleMode}>
              {registering ? "Already have an account? Sign in" : "Need an account? Create one"}
            </Button>
            <button type="button" onClick={onBrowseGallery} className="w-full text-center text-xs text-muted-foreground underline underline-offset-2">
              Browse shared films — no account needed
            </button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
