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

  const register = useCallback(async (username: string, password: string) => {
    const response = await apiPost<{ token: string; user: StudioUser }>("/auth/register", { username, password })
    setStoredToken(response.token)
    setUser(response.user)
  }, [])

  const logout = useCallback(() => {
    apiPost("/auth/logout", {}).catch(() => undefined).finally(() => {
      setStoredToken(null)
      setUser(null)
    })
  }, [])

  return { user, loading, login, register, logout, reloadUser: refresh }
}
