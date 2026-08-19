import { useCallback, useEffect, useState } from "react"

import { apiGet, apiPost, getStoredToken, onUnauthenticated, setStoredToken } from "@/lib/api"
import type { StudioUser } from "@/types"

export function useAuth() {
  const [user, setUser] = useState<StudioUser | null>(null)
  const [loading, setLoading] = useState(true)

  // `loading` gates the whole app behind a full-screen spinner, so it may only
  // describe the *initial* sign-in check. Raising it again on every re-read
  // (the render step re-reads the balance whenever a credit moves) tore the
  // entire tree down and rebuilt it mid-render for a request that changes one
  // number in the sidebar. It starts true and is only ever lowered.
  const refresh = useCallback(() => {
    if (!getStoredToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    apiGet<{ user: StudioUser }>("/auth/me")
      .then((response) => setUser(response.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(refresh, [refresh])
  useEffect(() => onUnauthenticated(() => setUser(null)), [])

  const login = useCallback(async (username: string, password: string) => {
    const response = await apiPost<{ token: string; user: StudioUser }>("/auth/login", { username, password })
    setStoredToken(response.token)
    setUser(response.user)
  }, [])

  const register = useCallback(async (input: { username: string; password: string; email: string }) => {
    // `acceptedTerms` is not a checkbox value forwarded from the form — the
    // form refuses to submit unless it is ticked, and the server rejects
    // anything but literal true, so sending it here states the same fact once.
    const response = await apiPost<{ token: string; user: StudioUser }>("/auth/register", { ...input, acceptedTerms: true })
    setStoredToken(response.token)
    setUser(response.user)
  }, [])

  // The backfill pair for accounts that predate email and the policy pages.
  // Both return the updated user so the gate that opened the dialog closes on
  // the server's answer rather than on an optimistic local guess.
  const setEmail = useCallback(async (email: string) => {
    const response = await apiPost<{ user: StudioUser }>("/auth/email", { email })
    setUser(response.user)
  }, [])

  const acceptTerms = useCallback(async () => {
    const response = await apiPost<{ user: StudioUser }>("/auth/accept-terms", {})
    setUser(response.user)
  }, [])

  const logout = useCallback(() => {
    apiPost("/auth/logout", {}).catch(() => undefined).finally(() => {
      setStoredToken(null)
      setUser(null)
    })
  }, [])

  return { user, loading, login, register, logout, setEmail, acceptTerms, reloadUser: refresh }
}
