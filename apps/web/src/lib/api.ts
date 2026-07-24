import { createSseParser, type ServerEvent } from "./sse"

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "")
const TOKEN_KEY = "storeel.session.token"
const UNAUTHENTICATED_EVENT = "storeel:unauthenticated"

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    // localStorage unavailable (private browsing, etc.) — session just won't persist across reloads.
  }
}

export function onUnauthenticated(listener: () => void) {
  window.addEventListener(UNAUTHENTICATED_EVENT, listener)
  return () => window.removeEventListener(UNAUTHENTICATED_EVENT, listener)
}

function authHeader(): HeadersInit {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function handleUnauthenticated() {
  setStoredToken(null)
  window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT))
}

export function apiEventUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

export function subscribeToApiEvents(path: string, handlers: {
  onOpen?: () => void
  onEvent: (event: ServerEvent) => void
  onError?: (error: unknown) => void
}) {
  let stopped = false
  let controller: AbortController | null = null
  let retry: number | null = null

  const connect = async () => {
    controller = new AbortController()
    let retryable = true
    try {
      const response = await fetch(apiEventUrl(path), {
        headers: { Accept: "text/event-stream", ...authHeader() },
        signal: controller.signal,
      })
      if (response.status === 401) { retryable = false; handleUnauthenticated() }
      if (!response.ok) throw new ApiError(`Event stream failed with status ${response.status}`, response.status, "EVENT_STREAM_FAILED")
      if (!response.body) throw new ApiError("The event stream has no response body", 0, "INVALID_RESPONSE")
      handlers.onOpen?.()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const push = createSseParser(handlers.onEvent)
      while (!stopped) {
        const result = await reader.read()
        if (result.done) break
        push(decoder.decode(result.value, { stream: true }))
      }
      push(decoder.decode())
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) handlers.onError?.(error)
    }
    if (!stopped && retryable) retry = window.setTimeout(() => { void connect() }, 2_000)
  }

  void connect()
  return () => {
    stopped = true
    controller?.abort()
    if (retry !== null) window.clearTimeout(retry)
  }
}

export async function apiBlob(path: string): Promise<Blob> {
  let response: Response
  try { response = await fetch(`${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, { headers: { ...authHeader() } }) }
  catch (error) { throw new ApiError(error instanceof Error ? error.message : "Unable to reach the API", 0, "NETWORK_ERROR") }
  if (response.status === 401) handleUnauthenticated()
  if (!response.ok) {
    let failure: ApiFailure | null = null
    try { const value = await response.json(); if (isFailure(value)) failure = value } catch { /* binary endpoint may return no JSON */ }
    throw new ApiError(failure?.error.message || `Request failed with status ${response.status}`, response.status, failure?.error.code || "REQUEST_FAILED", failure?.error.details)
  }
  return response.blob()
}

export async function downloadApiFile(path: string, filename: string) {
  const url = URL.createObjectURL(await apiBlob(path))
  try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click() }
  finally { window.setTimeout(() => URL.revokeObjectURL(url), 1_000) }
}

type ApiSuccess<T> = { ok: true; data: T }
type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } }

export class ApiError extends Error {
  readonly name = "ApiError"

  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

function isFailure(value: unknown): value is ApiFailure {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ApiFailure>
  return candidate.ok === false && typeof candidate.error?.code === "string" && typeof candidate.error.message === "string"
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { headers: { Accept: "application/json", ...authHeader() } })
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
  })
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(body),
  })
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE", headers: { Accept: "application/json", ...authHeader() } })
}

export function apiUpload<T>(path: string, file: File, onProgress: (progress: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open("POST", `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`)
    request.setRequestHeader("Accept", "application/json")
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream")
    const token = getStoredToken()
    if (token) request.setRequestHeader("Authorization", `Bearer ${token}`)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    request.onerror = () => reject(new ApiError("Unable to reach the API", 0, "NETWORK_ERROR"))
    request.onload = () => {
      if (request.status === 401) handleUnauthenticated()
      let payload: ApiSuccess<T> | ApiFailure
      try {
        payload = JSON.parse(request.responseText) as ApiSuccess<T> | ApiFailure
      } catch {
        reject(new ApiError("The API returned a non-JSON response", request.status, "INVALID_RESPONSE"))
        return
      }
      if (request.status < 200 || request.status >= 300 || isFailure(payload)) {
        const error = isFailure(payload) ? payload.error : null
        reject(new ApiError(error?.message || `Request failed with status ${request.status}`, request.status, error?.code || "REQUEST_FAILED", error?.details))
        return
      }
      if (payload.ok !== true || !("data" in payload)) {
        reject(new ApiError("The API returned an invalid response envelope", request.status, "INVALID_RESPONSE"))
        return
      }
      onProgress(100)
      resolve(payload.data)
    }
    request.send(file)
  })
}

async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`, init)
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "Unable to reach the API", 0, "NETWORK_ERROR")
  }

  if (response.status === 401) handleUnauthenticated()

  const text = await response.text()
  let payload: ApiSuccess<T> | ApiFailure
  try {
    payload = JSON.parse(text) as ApiSuccess<T> | ApiFailure
  } catch {
    throw new ApiError("The API returned a non-JSON response", response.status, "INVALID_RESPONSE", text.slice(0, 500))
  }

  if (!response.ok || isFailure(payload)) {
    const error = isFailure(payload) ? payload.error : null
    throw new ApiError(error?.message || `Request failed with status ${response.status}`, response.status, error?.code || "REQUEST_FAILED", error?.details)
  }

  if (payload.ok !== true || !("data" in payload)) {
    throw new ApiError("The API returned an invalid response envelope", response.status, "INVALID_RESPONSE")
  }

  return payload.data
}
