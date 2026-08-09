import { useState } from "react"
import { Eye, EyeOff, KeyRound, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n } from "@/lib/i18n"

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError(t("password.mismatch"))
      return
    }
    setSubmitting(true)
    try {
      await apiPost("/auth/password", { currentPassword, newPassword })
      setSuccess(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (reason) {
      setError(apiMessage(reason, t, "password.failed"))
    } finally {
      setSubmitting(false)
    }
  }

  // The reveal button used to sit inside the <label>, so each input's accessible
  // name computed to "New password Show new password". Label and control are
  // now associated by id instead of by nesting.
  function passwordField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    name: keyof typeof visible,
    autoComplete: string,
  ) {
    const shown = visible[name]
    const id = `password-${name}`
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium">{label}</label>
        <span className="relative block">
          <input
            id={id}
            type={shown ? "text" : "password"}
            autoComplete={autoComplete}
            className="field mt-0 w-full pr-10"
            minLength={name === "current" ? undefined : 8}
            aria-describedby={name === "next" ? "password-next-hint" : undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
            aria-label={t(shown ? "password.hide" : "password.show", { field: label.toLowerCase() })}
            onClick={() => setVisible((state) => ({ ...state, [name]: !shown }))}
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
        {name === "next" && <p id="password-next-hint" className="text-xs text-muted-foreground">{t("login.passwordHint")}</p>}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 text-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="change-password-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><KeyRound className="size-5 text-primary" /> {t("password.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("password.intro")}</p>
          </div>
          <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-muted" aria-label={t("common.close")} onClick={onClose}><X className="size-4" /></button>
        </div>

        {success ? (
          <div className="mt-6">
            <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success-text">{t("password.success")}</p>
            <Button className="mt-4 w-full" onClick={onClose}>{t("common.done")}</Button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {passwordField(t("password.current"), currentPassword, setCurrentPassword, "current", "current-password")}
            {passwordField(t("password.new"), newPassword, setNewPassword, "next", "new-password")}
            {passwordField(t("password.confirm"), confirmPassword, setConfirmPassword, "confirm", "new-password")}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={submitting || !currentPassword || newPassword.length < 8 || !confirmPassword}>
                {submitting ? t("password.changing") : t("password.title")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
