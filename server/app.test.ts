import assert from "node:assert/strict"
import { createServer, type IncomingMessage } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import test from "node:test"

import { z } from "zod"

import { createRequestHandler } from "./app.js"
import { config } from "./config.js"
import { HttpError, readJsonBody } from "./http.js"
import { AuthRequestError } from "./services/auth.js"
import { JobRequestError, type JobSnapshot } from "./services/jobs.js"
import { AnalysisRequestError, type AnalysisSnapshot } from "./services/analysis.js"
import { ProjectAlreadyExistsError, type ProjectSummary } from "./services/projects.js"
import type { RecipeSummary } from "./services/recipes.js"

const TEST_SESSION_TOKEN = "test-session-token"
const TEST_USER_ID = "test-user"

// Shared fixture for the many /api/projects/:id/... route tests below — the
// app-wide ownership gate (server/app.ts) now calls getProject() on every
// project-scoped request, so any test that reaches such a route needs a
// getProject override returning a project owned by the session user.
const OWNED_PROJECT: ProjectSummary = {
  id: "linh-nam", name: "Linh & Nam", tier: "template", recipe: "warm-film-01", quality: "share",
  language: "vi", sequenceMode: "editorial", status: "not_started", currentPhase: null, progress: 0,
  updatedAt: "2026-07-21T10:00:00.000Z", createdAt: "2026-07-21T10:00:00.000Z", error: null,
  phases: { validate: "pending", analyze: "pending", plan: "pending", build: "pending", render: "pending", qa: "pending", deliver: "pending" },
  ownerId: TEST_USER_ID,
}

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  overrides: Parameters<typeof createRequestHandler>[0] = {},
) {
  const server = createServer(createRequestHandler({
    getSession: async (token) => token === TEST_SESSION_TOKEN ? { userId: "test-user" } : null,
    ...overrides,
  }))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${TEST_SESSION_TOKEN}`)
    return originalFetch(input, { ...init, headers })
  }) as typeof fetch
  try {
    const { port } = server.address() as AddressInfo
    await run(`http://127.0.0.1:${port}`)
  } finally {
    globalThis.fetch = originalFetch
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

test("health, CORS, method, recipe, and not-found responses follow the API envelope", async () => {
  await withServer(async (baseUrl) => {
    const healthResponse = await fetch(`${baseUrl}/api/health`)
    assert.equal(healthResponse.status, 200)
    const health = await healthResponse.json() as { ok: boolean; data: { service: string; status: string; version: string; timestamp: string } }
    assert.equal(health.ok, true)
    assert.equal(health.data.service, "storeel-api")
    assert.equal(health.data.status, "ok")
    assert.equal(health.data.version, config.version)
    assert.ok(Number.isFinite(Date.parse(health.data.timestamp)))

    const allowedOrigin = [...config.webOrigins][0]
    const preflightResponse = await fetch(`${baseUrl}/api/health`, { method: "OPTIONS", headers: { Origin: allowedOrigin } })
    assert.equal(preflightResponse.status, 204)
    assert.equal(preflightResponse.headers.get("access-control-allow-origin"), allowedOrigin)

    const methodResponse = await fetch(`${baseUrl}/api/health`, { method: "POST" })
    assert.equal(methodResponse.status, 405)
    assert.equal(methodResponse.headers.get("allow"), "GET, OPTIONS")

    const recipeResponse = await fetch(`${baseUrl}/api/recipes`)
    assert.equal(recipeResponse.status, 200)
    assert.deepEqual(await recipeResponse.json(), { ok: true, data: [] })

    const missingResponse = await fetch(`${baseUrl}/api/missing`)
    assert.equal(missingResponse.status, 404)
    assert.deepEqual(await missingResponse.json(), {
      ok: false,
      error: { code: "NOT_FOUND", message: "No route for GET /api/missing" },
    })
  }, { listRecipes: async () => [] })
})

test("disallowed origins are rejected", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "https://example.invalid" } })
    assert.equal(response.status, 403)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "ORIGIN_DENIED")
  })
})

test("missing or invalid bearer token is rejected on protected routes", async () => {
  await withServer(async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/recipes`, { headers: { Authorization: "" } })
    assert.equal(missing.status, 401)
    assert.equal((await missing.json() as { error: { code: string } }).error.code, "UNAUTHENTICATED")

    const invalid = await fetch(`${baseUrl}/api/recipes`, { headers: { Authorization: "Bearer not-a-real-token" } })
    assert.equal(invalid.status, 401)

    const health = await fetch(`${baseUrl}/api/health`, { headers: { Authorization: "" } })
    assert.equal(health.status, 200)
  }, { listRecipes: async () => [] })
})

test("technical incidents are restricted to configured administrators", async (context) => {
  const previous = process.env.STOREEL_ADMIN_USERNAMES
  process.env.STOREEL_ADMIN_USERNAMES = "storeel"
  context.after(() => {
    if (previous === undefined) delete process.env.STOREEL_ADMIN_USERNAMES
    else process.env.STOREEL_ADMIN_USERNAMES = previous
  })
  const incident = {
    id: "INC-1", code: "RENDER_FAILED", projectId: "linh-nam", userId: TEST_USER_ID, phase: "render" as const,
    status: "new" as const, message: "Render failed", technicalDetail: "exit 1", customerImpact: "Video unavailable",
    occurrences: 1, createdAt: "2026-07-24T00:00:00.000Z", updatedAt: "2026-07-24T00:00:00.000Z", resolvedAt: null,
  }
  await withServer(async (baseUrl) => {
    const denied = await fetch(`${baseUrl}/api/admin/incidents`)
    assert.equal(denied.status, 403)
    assert.equal((await denied.json() as { error: { code: string } }).error.code, "ADMIN_REQUIRED")
  }, {
    getUserById: async () => ({ id: TEST_USER_ID, username: "customer", plan: { type: "per_video", creditsRemaining: 0 } }),
  })
  await withServer(async (baseUrl) => {
    const listed = await fetch(`${baseUrl}/api/admin/incidents`)
    assert.equal(listed.status, 200)
    assert.equal((await listed.json() as { data: { openCount: number } }).data.openCount, 1)
    const updated = await fetch(`${baseUrl}/api/admin/incidents/INC-1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "resolved" }),
    })
    assert.equal(updated.status, 200)
    assert.equal((await updated.json() as { data: { status: string } }).data.status, "resolved")
    const retried = await fetch(`${baseUrl}/api/admin/incidents/INC-1/retry`, { method: "POST" })
    assert.equal(retried.status, 200)
  }, {
    getUserById: async () => ({ id: TEST_USER_ID, username: "storeel", plan: { type: "per_video", creditsRemaining: 0 } }),
    listIncidents: () => ({ incidents: [incident], openCount: 1 }),
    updateIncident: (_id, status) => ({ ...incident, status }),
    retryIncident: () => ({ ...incident, status: "resolved" }),
  })
})

test("login issues a session, logout revokes it, and /api/auth/me reports the user", async () => {
  const user = { id: "11111111-1111-4111-8111-111111111111", username: "alice" }
  let deletedToken: string | null = null
  await withServer(async (baseUrl) => {
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "alice", password: "wrong" }) })
    assert.equal(badLogin.status, 401)
    assert.equal((await badLogin.json() as { error: { code: string } }).error.code, "INVALID_CREDENTIALS")

    const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "alice", password: "correct-secret" }) })
    assert.equal(login.status, 200)
    const loginBody = await login.json() as { data: { token: string; user: typeof user } }
    assert.deepEqual(loginBody.data.user, user)

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${loginBody.data.token}` } })
    assert.equal(me.status, 200)
    assert.deepEqual((await me.json() as { data: { user: typeof user } }).data.user, user)

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${loginBody.data.token}` } })
    assert.equal(logout.status, 200)
    assert.equal(deletedToken, loginBody.data.token)
  }, {
    verifyLogin: async (input) => {
      if (input.username !== "alice" || input.password !== "correct-secret") {
        throw new AuthRequestError(401, "INVALID_CREDENTIALS", "Invalid username or password")
      }
      return user
    },
    createSession: async () => "issued-token",
    getSession: async (token) => token === "issued-token" ? { userId: user.id } : null,
    getUserById: async (id) => id === user.id ? user : null,
    deleteSession: async (token) => { deletedToken = token },
  })
})

test("registration creates a user and signs the new account in", async () => {
  const user = { id: "22222222-2222-4222-8222-222222222222", username: "new-user" }
  let registered: { username: string; password: string } | null = null
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Bad Name", password: "short" }) })
    assert.equal(invalid.status, 400)

    const response = await fetch(`${baseUrl}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "new-user", password: "correct-secret" }) })
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { ok: true, data: { token: "new-session", user } })
    assert.deepEqual(registered, { username: "new-user", password: "correct-secret" })
  }, {
    createUser: async (input) => { registered = input; return user },
    createSession: async (userId) => {
      assert.equal(userId, user.id)
      return "new-session"
    },
  })
})

test("authenticated users can change their password", async () => {
  let changed: { userId: string; currentPassword: string; newPassword: string } | null = null
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/auth/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "correct-secret", newPassword: "short" }),
    })
    assert.equal(invalid.status, 400)

    const response = await fetch(`${baseUrl}/api/auth/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: "correct-secret", newPassword: "new-correct-secret" }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, data: { changed: true } })
    assert.deepEqual(changed, { userId: "test-user", currentPassword: "correct-secret", newPassword: "new-correct-secret" })
  }, {
    changePassword: async (userId, input) => { changed = { userId, ...input } },
  })
})

test("unhandled service errors become a generic JSON 500", async () => {
  const originalError = console.error
  console.error = () => undefined
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/recipes`)
      assert.equal(response.status, 500)
      assert.deepEqual(await response.json(), {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "The server could not complete the request" },
      })
    }, { listRecipes: async () => { throw new Error("private filesystem detail") } })
  } finally {
    console.error = originalError
  }
})

test("recipe detail and project routes return service data and typed 404s", async () => {
  const recipe: RecipeSummary = {
    id: "warm-film-01", name: "Warm Film", libraryTheme: "warm_film", themeBackground: "#fff", themeAccent: "#a65",
    bestFor: ["candid"], minPhotos: 35, idealPhotos: 70, maxPhotos: null, moods: ["warm"], energy: "low_to_medium",
    storyArc: ["opening", "closing"], palette: { cream: "#fff" }, fonts: {}, sceneCount: 9, lookCount: 8,
    pacingVariants: ["tender"], notes: "Warm film",
  }
  const project: ProjectSummary = {
    id: "linh-nam", name: "Linh & Nam", tier: "template", recipe: "warm-film-01", quality: "share",
    language: "vi", sequenceMode: "editorial", status: "paused", currentPhase: "plan", progress: 29,
    updatedAt: "2026-07-21T10:00:00.000Z", createdAt: "2026-07-20T10:00:00.000Z", error: null,
    phases: { validate: "completed", analyze: "completed", plan: "running", build: "pending", render: "pending", qa: "pending", deliver: "pending" },
    ownerId: TEST_USER_ID,
  }
  await withServer(async (baseUrl) => {
    const recipeResponse = await fetch(`${baseUrl}/api/recipes/warm-film-01`)
    assert.equal(recipeResponse.status, 200)
    assert.deepEqual((await recipeResponse.json() as { data: RecipeSummary }).data, recipe)

    const projectsResponse = await fetch(`${baseUrl}/api/projects`)
    assert.equal(projectsResponse.status, 200)
    assert.deepEqual((await projectsResponse.json() as { data: { projects: ProjectSummary[] } }).data.projects, [project])

    const projectResponse = await fetch(`${baseUrl}/api/projects/linh-nam`)
    assert.equal(projectResponse.status, 200)
    assert.deepEqual((await projectResponse.json() as { data: ProjectSummary }).data, project)

    const missingResponse = await fetch(`${baseUrl}/api/projects/missing-project`)
    assert.equal(missingResponse.status, 404)
    assert.equal((await missingResponse.json() as { error: { code: string } }).error.code, "PROJECT_NOT_FOUND")
  }, {
    getRecipe: async (id) => id === recipe.id ? recipe : null,
    listProjects: async () => ({ projects: [project], issues: [] }),
    getProject: async (id) => id === project.id ? project : null,
  })
})

function requestBody(body: string, contentType = "application/json"): IncomingMessage {
  return Object.assign(Readable.from([body]), {
    headers: { "content-type": contentType, "content-length": String(Buffer.byteLength(body)) },
  }) as IncomingMessage
}

test("JSON body helper validates syntax, schema, media type, and size", async () => {
  const schema = z.object({ name: z.string().min(1) })
  assert.deepEqual(await readJsonBody(requestBody('{"name":"StoReel"}'), schema), { name: "StoReel" })
  await assert.rejects(readJsonBody(requestBody("{"), schema), (error: unknown) => error instanceof HttpError && error.code === "INVALID_JSON")
  await assert.rejects(readJsonBody(requestBody('{"name":""}'), schema), (error: unknown) => error instanceof HttpError && error.code === "VALIDATION_ERROR")
  await assert.rejects(readJsonBody(requestBody("{}", "text/plain"), schema), (error: unknown) => error instanceof HttpError && error.code === "UNSUPPORTED_MEDIA_TYPE")
  await assert.rejects(readJsonBody(requestBody('{"name":"too long"}'), schema, 4), (error: unknown) => error instanceof HttpError && error.code === "BODY_TOO_LARGE")
})

test("POST /api/projects validates intake and maps duplicate projects to 409", async () => {
  const created: ProjectSummary = {
    id: "linh-nam", name: "Linh & Nam", tier: "template", recipe: "warm-film-01", quality: "share",
    language: "vi", sequenceMode: "editorial", status: "not_started", currentPhase: null, progress: 0,
    updatedAt: "2026-07-21T10:00:00.000Z", createdAt: "2026-07-21T10:00:00.000Z", error: null,
    phases: { validate: "pending", analyze: "pending", plan: "pending", build: "pending", render: "pending", qa: "pending", deliver: "pending" },
  }
  const validInput = {
    name: "Linh & Nam", bride: "Linh", groom: "Nam", language: "vi", sequenceMode: "editorial",
    tier: "template", recipe: "warm-film-01", quality: "share", musicMode: "auto", creativeBrief: "",
  }
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...validInput, recipe: undefined }) })
    assert.equal(invalid.status, 400)
    assert.equal((await invalid.json() as { error: { code: string } }).error.code, "VALIDATION_ERROR")

    const response = await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validInput) })
    assert.equal(response.status, 201)
    assert.deepEqual((await response.json() as { data: ProjectSummary }).data, created)
  }, { createProject: async () => created })

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(validInput) })
    assert.equal(response.status, 409)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "PROJECT_EXISTS")
  }, { createProject: async () => { throw new ProjectAlreadyExistsError("Project already exists: linh-nam") } })
})

test("project asset routes forward binary uploads and support list and delete", async () => {
  const asset = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "photo" as const,
    originalName: "Ceremony 01.jpg",
    storedName: "000003-ceremony-01.jpg",
    uploadIndex: 3,
    mimeType: "image/jpeg",
    size: 5,
    uploadedAt: "2026-07-21T10:00:00.000Z",
  }
  const assets = { photos: [asset], music: [], limits: { photoMaxBytes: 50, musicMaxBytes: 200 } }
  let receivedBody = ""
  await withServer(async (baseUrl) => {
    const uploadResponse = await fetch(`${baseUrl}/api/projects/linh-nam/assets?kind=photo&filename=${encodeURIComponent(asset.originalName)}&uploadIndex=3`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: "image",
    })
    assert.equal(uploadResponse.status, 201)
    assert.deepEqual((await uploadResponse.json() as { data: typeof asset }).data, asset)
    assert.equal(receivedBody, "image")

    const listResponse = await fetch(`${baseUrl}/api/projects/linh-nam/assets`)
    assert.equal(listResponse.status, 200)
    assert.deepEqual((await listResponse.json() as { data: typeof assets }).data, assets)

    const deleteResponse = await fetch(`${baseUrl}/api/projects/linh-nam/assets/${asset.id}`, { method: "DELETE" })
    assert.equal(deleteResponse.status, 200)
    assert.deepEqual((await deleteResponse.json() as { data: typeof assets }).data, assets)
  }, {
    getProject: async () => OWNED_PROJECT,
    uploadProjectAsset: async (input) => {
      for await (const chunk of input.body) receivedBody += Buffer.from(chunk).toString("utf8")
      assert.equal(input.filename, asset.originalName)
      assert.equal(input.uploadIndex, 3)
      return asset
    },
    listProjectAssets: async () => assets,
    deleteProjectAsset: async () => assets,
  })
})

test("project asset content route streams uploaded media for instant preview", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-asset-content-route-"))
  const file = path.join(root, "soundtrack.mp3")
  await writeFile(file, "audio-bytes")
  context.after(() => rm(root, { recursive: true, force: true }))

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/linh-nam/assets/11111111-1111-4111-8111-111111111111/content`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "audio/mpeg")
    assert.equal(await response.text(), "audio-bytes")
  }, {
    getProject: async () => OWNED_PROJECT,
    getProjectAssetFile: async () => ({
      id: "11111111-1111-4111-8111-111111111111", kind: "music", originalName: "soundtrack.mp3",
      storedName: "soundtrack.mp3", uploadIndex: 0, mimeType: "audio/mpeg", size: 11,
      uploadedAt: "2026-07-21T10:00:00.000Z", absolutePath: file,
    }),
  })
})

test("project job routes validate start, cancel, and open an SSE snapshot stream", async () => {
  const snapshot: JobSnapshot = {
    projectId: "linh-nam", status: "running", currentPhase: "analyze", progress: 14, error: null,
    startedAt: "2026-07-21T10:00:00.000Z", updatedAt: "2026-07-21T10:01:00.000Z", mode: "dry_run", deliver: false,
    phases: { validate: "completed", analyze: "running", plan: "pending", build: "pending", render: "pending", qa: "pending", deliver: "pending" },
  }
  let unsubscribed = false
  await withServer(async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    assert.equal(invalid.status, 400)
    const invalidDelivery = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "dry_run", deliver: true }) })
    assert.equal(invalidDelivery.status, 400)

    const started = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "dry_run" }) })
    assert.equal(started.status, 202)
    assert.deepEqual((await started.json() as { data: JobSnapshot }).data, snapshot)

    const current = await fetch(`${baseUrl}/api/projects/linh-nam/job`)
    assert.equal(current.status, 200)
    const cancelled = await fetch(`${baseUrl}/api/projects/linh-nam/job/cancel`, { method: "POST" })
    assert.equal(cancelled.status, 200)

    const controller = new AbortController()
    const events = await fetch(`${baseUrl}/api/projects/linh-nam/job/events`, { signal: controller.signal })
    assert.equal(events.headers.get("content-type"), "text/event-stream; charset=utf-8")
    const reader = events.body!.getReader()
    const first = await reader.read()
    assert.match(new TextDecoder().decode(first.value), /event: snapshot/)
    controller.abort()
    await reader.cancel().catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(unsubscribed, true)
  }, {
    getProject: async () => OWNED_PROJECT,
    getJob: async () => snapshot,
    startJob: async () => snapshot,
    cancelJob: async () => snapshot,
    subscribeToJob: () => () => { unsubscribed = true },
  })
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "render" }) })
    assert.equal(response.status, 409)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "JOB_ALREADY_RUNNING")
  }, {
    getProject: async () => OWNED_PROJECT,
    consumeRenderEntitlement: async () => undefined,
    startJob: async () => { throw new JobRequestError(409, "JOB_ALREADY_RUNNING", "already running") },
  })
})

test("render jobs are metered by plan entitlement, dry runs are not", async () => {
  const snapshot: JobSnapshot = {
    projectId: "linh-nam", status: "running", currentPhase: "render", progress: 60, error: null,
    startedAt: "2026-07-21T10:00:00.000Z", updatedAt: "2026-07-21T10:01:00.000Z", mode: "render", deliver: false,
    phases: { validate: "completed", analyze: "completed", plan: "completed", build: "completed", render: "running", qa: "pending", deliver: "pending" },
  }
  const calls: string[] = []

  // A render with entitlement remaining consumes it and reaches the job runner.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "render" }) })
    assert.equal(response.status, 202)
  }, {
    getProject: async () => OWNED_PROJECT,
    consumeRenderEntitlement: async () => { calls.push("consumed"); },
    startJob: async () => { calls.push("started"); return snapshot },
  })
  assert.deepEqual(calls, ["consumed", "started"])

  // An exhausted plan is rejected with 402 before the job runner is ever touched.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "render" }) })
    assert.equal(response.status, 402)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "RENDER_QUOTA_EXCEEDED")
  }, {
    getProject: async () => OWNED_PROJECT,
    consumeRenderEntitlement: async () => { throw new AuthRequestError(402, "RENDER_QUOTA_EXCEEDED", "No render credits remaining") },
    startJob: async () => { throw new Error("startJob must not be called once entitlement is exhausted") },
  })

  // dry_run stays free — no entitlement check at all.
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/linh-nam/job`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "dry_run" }) })
    assert.equal(response.status, 202)
  }, {
    getProject: async () => OWNED_PROJECT,
    consumeRenderEntitlement: async () => { throw new Error("dry_run must not consume entitlement") },
    startJob: async () => snapshot,
  })
})

test("project artifact routes list files and serve video byte ranges", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-artifact-route-"))
  const file = path.join(root, "preview.mp4")
  await writeFile(file, Buffer.from("0123456789"))
  context.after(() => rm(root, { recursive: true, force: true }))
  const artifact = {
    id: "preview" as const, label: "Preview", kind: "video" as const, mimeType: "video/mp4",
    ready: true, stale: false, size: 10, updatedAt: "2026-07-22T10:00:00.000Z",
    url: "/projects/linh-nam/artifacts/preview", absolutePath: file, filename: "preview.mp4",
  }
  await withServer(async (baseUrl) => {
    const listed = await fetch(`${baseUrl}/api/projects/linh-nam/artifacts`)
    assert.equal(listed.status, 200)
    assert.equal((await listed.json() as { data: Array<{ id: string }> }).data[0].id, "preview")

    const ranged = await fetch(`${baseUrl}/api/projects/linh-nam/artifacts/preview`, { headers: { Range: "bytes=2-5" } })
    assert.equal(ranged.status, 206)
    assert.equal(ranged.headers.get("content-range"), "bytes 2-5/10")
    assert.equal(await ranged.text(), "2345")

    const invalidRange = await fetch(`${baseUrl}/api/projects/linh-nam/artifacts/preview`, { headers: { Range: "bytes=20-30" } })
    assert.equal(invalidRange.status, 416)
  }, {
    getProject: async () => OWNED_PROJECT,
    listProjectArtifacts: async () => [{ ...artifact }].map(({ absolutePath: _path, filename: _filename, ...value }) => value),
    getProjectArtifact: async () => artifact,
  })
})

test("project timeline routes read, replace, validate, and serve scene images", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-timeline-route-"))
  const image = path.join(root, "scene.jpg")
  await writeFile(image, "photo")
  context.after(() => rm(root, { recursive: true, force: true }))
  const snapshot = {
    projectId: "linh-nam", ready: true, path: "timeline/timeline.json",
    project: { name: "Linh & Nam", width: 1920, height: 1080, fps: 30 }, totalDuration: 5,
    scenes: [{ id: "scene_001", index: 0, start: 0, end: 5, duration: 5, effect: "still", renderer: "ffmpeg", layout: null,
      transition: { type: "none", duration: 0 }, captions: [], images: [{ id: "image", label: "Hero image", path: "projects/linh-nam/input/scene.jpg", url: "/projects/linh-nam/timeline/images/0/image" }] }],
    renderUrl: null, updatedAt: "2026-07-22T10:00:00.000Z",
  }
  let replacement = ""
  await withServer(async (baseUrl) => {
    const current = await fetch(`${baseUrl}/api/projects/linh-nam/timeline`)
    assert.equal(current.status, 200)
    assert.deepEqual((await current.json() as { data: typeof snapshot }).data, snapshot)

    const invalid = await fetch(`${baseUrl}/api/projects/linh-nam/timeline`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" })
    assert.equal(invalid.status, 400)
    const updated = await fetch(`${baseUrl}/api/projects/linh-nam/timeline`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sceneId: "scene_001", slotId: "image", assetId: "11111111-1111-4111-8111-111111111111" }) })
    assert.equal(updated.status, 200)
    assert.equal(replacement, "scene_001:image")

    const served = await fetch(`${baseUrl}/api/projects/linh-nam/timeline/images/0/image`)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get("content-type"), "image/jpeg")
    assert.equal(await served.text(), "photo")
  }, {
    getProject: async () => OWNED_PROJECT,
    getTimeline: async () => snapshot,
    replaceTimelineImage: async (_projectId, input) => { replacement = `${input.sceneId}:${input.slotId}`; return snapshot },
    getTimelineImage: async () => ({ absolutePath: image, filename: "scene.jpg", mimeType: "image/jpeg", size: 5 }),
  })
})

test("project analysis routes validate runs and keep cull suggestion separate from apply", async () => {
  const snapshot: AnalysisSnapshot = {
    projectId: "linh-nam", run: null,
    photos: { uploaded: 3, technical: 3, semantic: 0, generatedBy: null }, music: [],
    vision: { model: "gpt-5.5", provider: "api.openai.com", configured: false, photoCount: 3, requests: 1, imageInputTokens: 768, estimatedUsd: { low: 0.01, high: 0.02 }, pricingNote: "estimate" },
    cull: null, appliedCull: null,
  }
  const calls: string[] = []
  await withServer(async (baseUrl) => {
    const current = await fetch(`${baseUrl}/api/projects/linh-nam/analysis`)
    assert.equal(current.status, 200)
    const invalid = await fetch(`${baseUrl}/api/projects/linh-nam/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    assert.equal(invalid.status, 400)
    const started = await fetch(`${baseUrl}/api/projects/linh-nam/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "technical" }) })
    assert.equal(started.status, 202)
    const suggested = await fetch(`${baseUrl}/api/projects/linh-nam/analysis/cull`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keep: 2 }) })
    assert.equal(suggested.status, 200)
    const applied = await fetch(`${baseUrl}/api/projects/linh-nam/analysis/cull/apply`, { method: "POST" })
    assert.equal(applied.status, 200)
  }, {
    getProject: async () => OWNED_PROJECT,
    getAnalysis: async () => snapshot,
    startAnalysis: async () => { calls.push("start"); return snapshot },
    suggestCull: async () => { calls.push("suggest"); return snapshot },
    applyCull: async () => { calls.push("apply"); return snapshot },
  })
  assert.deepEqual(calls, ["start", "suggest", "apply"])

  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/linh-nam/analysis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "vision" }) })
    assert.equal(response.status, 409)
    assert.equal((await response.json() as { error: { code: string } }).error.code, "VISION_NOT_CONFIGURED")
  }, { getProject: async () => OWNED_PROJECT, startAnalysis: async () => { throw new AnalysisRequestError(409, "VISION_NOT_CONFIGURED", "not configured") } })
})

test("sharing a project requires an existing release, and toggles the shared flag", async () => {
  await withServer(async (baseUrl) => {
    const blocked = await fetch(`${baseUrl}/api/projects/linh-nam/share`, { method: "POST" })
    assert.equal(blocked.status, 409)
    assert.equal((await blocked.json() as { error: { code: string } }).error.code, "PROJECT_NOT_RELEASED")
  }, {
    getProject: async () => OWNED_PROJECT,
    getDelivery: async () => ({ projectId: "linh-nam", artifacts: [], summary: null, approval: { status: "none", approvedAt: null, reason: null }, release: null }),
  })

  await withServer(async (baseUrl) => {
    const shared = await fetch(`${baseUrl}/api/projects/linh-nam/share`, { method: "POST" })
    assert.equal(shared.status, 200)
    assert.equal((await shared.json() as { data: ProjectSummary }).data.shared, true)

    const unshared = await fetch(`${baseUrl}/api/projects/linh-nam/share`, { method: "DELETE" })
    assert.equal(unshared.status, 200)
    assert.equal((await unshared.json() as { data: ProjectSummary }).data.shared, false)
  }, {
    getProject: async () => OWNED_PROJECT,
    getDelivery: async () => ({ projectId: "linh-nam", artifacts: [], summary: null, approval: { status: "approved", approvedAt: "2026-07-22T10:00:00.000Z", reason: null }, release: { releasedAt: "2026-07-22T10:00:00.000Z" } }),
    setProjectShared: async (_projectId, shared) => ({ ...OWNED_PROJECT, shared }),
  })
})

test("the public gallery lists only shared projects and streams shared video without a session", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-gallery-route-"))
  const file = path.join(root, "final.mp4")
  await writeFile(file, Buffer.from("0123456789"))
  context.after(() => rm(root, { recursive: true, force: true }))

  const sharedProject: ProjectSummary = { ...OWNED_PROJECT, id: "public-linh-nam", shared: true }
  const artifact = {
    id: "delivery" as const, label: "Delivery", kind: "video" as const, mimeType: "video/mp4",
    ready: true, stale: false, size: 10, updatedAt: "2026-07-22T10:00:00.000Z",
    url: "/projects/public-linh-nam/artifacts/delivery", absolutePath: file, filename: "final.mp4",
  }

  await withServer(async (baseUrl) => {
    // No Authorization header at all — the gallery must not require a studio session.
    const list = await fetch(`${baseUrl}/api/gallery`, { headers: { Authorization: "" } })
    assert.equal(list.status, 200)
    assert.deepEqual((await list.json() as { data: unknown }).data, [{ id: sharedProject.id, name: sharedProject.name, updatedAt: sharedProject.updatedAt }])

    const video = await fetch(`${baseUrl}/api/gallery/${sharedProject.id}/video`, { headers: { Authorization: "" } })
    assert.equal(video.status, 200)
    assert.equal(await video.text(), "0123456789")

    const notShared = await fetch(`${baseUrl}/api/gallery/linh-nam/video`, { headers: { Authorization: "" } })
    assert.equal(notShared.status, 404)
  }, {
    listSharedProjects: async () => [sharedProject],
    getProject: async (id) => id === sharedProject.id ? sharedProject : OWNED_PROJECT,
    getProjectArtifact: async () => artifact,
  })
})
