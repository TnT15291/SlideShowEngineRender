import { useState } from "react"
import { Eye, EyeOff, KeyRound, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ApiError, apiPost } from "@/lib/api"

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
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
      setError("New passwords do not match")
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
      setError(reason instanceof ApiError ? reason.message : "Unable to change password")
    } finally {
      setSubmitting(false)
    }
  }

  function passwordField(
    label: string,
    value: string,
    onChange: (value: string) => void,
    name: keyof typeof visible,
    autoComplete: string,
  ) {
    const shown = visible[name]
    return (
      <label className="block space-y-1.5 text-sm font-medium">
        {label}
        <span className="relative block">
          <input
            type={shown ? "text" : "password"}
            autoComplete={autoComplete}
            className="field w-full pr-10"
            minLength={name === "current" ? undefined : 8}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="absolute bottom-0 right-0 top-2 grid w-10 place-items-center text-muted-foreground hover:text-foreground"
            aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            onClick={() => setVisible((state) => ({ ...state, [name]: !shown }))}
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>
    )
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
      <div className="w-full max-w-md rounded-xl border bg-background p-6 text-foreground shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="change-password-title" className="flex items-center gap-2 font-serif text-xl font-semibold"><KeyRound className="size-5 text-primary" /> Change password</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter your current password before choosing a new one.</p>
          </div>
          <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-muted" aria-label="Close" onClick={onClose}><X className="size-4" /></button>
        </div>

        {success ? (
          <div className="mt-6">
            <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success">Password changed successfully.</p>
            <Button className="mt-4 w-full" onClick={onClose}>Done</Button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            {passwordField("Current password", currentPassword, setCurrentPassword, "current", "current-password")}
            {passwordField("New password", newPassword, setNewPassword, "next", "new-password")}
            {passwordField("Confirm new password", confirmPassword, setConfirmPassword, "confirm", "new-password")}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button type="submit" disabled={submitting || !currentPassword || newPassword.length < 8 || !confirmPassword}>
                {submitting ? "Changing password…" : "Change password"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
