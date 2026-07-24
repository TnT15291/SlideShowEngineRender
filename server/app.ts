import type { IncomingMessage, ServerResponse } from "node:http"
import { createReadStream } from "node:fs"

import { ZodError } from "zod"
import { z } from "zod"

import { config } from "./config.js"
import { HttpError, readJsonBody, readRawBody, sendError, sendJson } from "./http.js"
import { AuthRequestError, changePassword, changePasswordInputSchema, consumeRenderEntitlement, createSession, createUser, deleteSession, getSession, getUserById, loginInputSchema, registerInputSchema, verifyLogin, type AuthenticatedUser, type ChangePasswordInput, type LoginInput, type RegisterInput } from "./services/auth.js"
import { BillingRequestError, createCheckoutSession, getPlanCatalog, handleWebhookEvent, type PlanId } from "./services/billing.js"
import { AssetRequestError, deleteProjectAsset, getProjectAssetFile, listProjectAssets, uploadProjectAsset, type ProjectAsset, type ProjectAssetFile, type ProjectAssets, type UploadAssetInput } from "./services/assets.js"
import { analysisService, AnalysisRequestError, cullInputSchema, startAnalysisInputSchema, type AnalysisSnapshot, type StartAnalysisInput } from "./services/analysis.js"
import { directorGenerateSchema, directorMusicChoiceSchema, directorService, directorStoryChoiceSchema, DirectorRequestError, type DirectorGenerateInput, type DirectorMusicChoiceInput, type DirectorState, type DirectorStoryChoiceInput } from "./services/director.js"
import { deliveryService, DeliveryRequestError, type DeliverySnapshot } from "./services/delivery.js"
import { artifactService, ArtifactRequestError, type ProjectArtifact, type ProjectArtifactFile } from "./services/artifacts.js"
import { jobRunner, JobRequestError, startJobInputSchema, type JobEvent, type JobSnapshot, type StartJobInput } from "./services/jobs.js"
import { incidentService, IncidentRequestError, updateIncidentSchema, type Incident, type IncidentStatus } from "./services/incidents.js"
import { createProject, createProjectInputSchema, getProject, listProjects, listSharedProjects, ProjectAlreadyExistsError, setProjectShared, type CreateProjectInput, type ProjectListResult, type ProjectSummary, UnknownRecipeError } from "./services/projects.js"
import { qaService, QaRequestError, type QaSnapshot } from "./services/qa.js"
import { getRecipe, listRecipes, type RecipeSummary } from "./services/recipes.js"
import { revisionInputSchema, revisionService, revisionUndoSchema, RevisionRequestError, type RevisionInput, type RevisionResult, type RevisionSnapshot, type RevisionUndoInput } from "./services/revisions.js"
import { replaceTimelineImageSchema, timelineService, TimelineRequestError, type ReplaceTimelineImageInput, type TimelineImageFile, type TimelineSnapshot } from "./services/timeline.js"

type Services = {
  verifyLogin: (input: LoginInput) => Promise<AuthenticatedUser>
  createUser: (input: RegisterInput) => Promise<AuthenticatedUser>
  changePassword: (userId: string, input: ChangePasswordInput) => Promise<void>
  createSession: (userId: string) => Promise<string>
  deleteSession: (token: string) => Promise<void>
  getSession: (token: string) => Promise<{ userId: string } | null>
  getUserById: (userId: string) => Promise<AuthenticatedUser | null>
  consumeRenderEntitlement: (userId: string) => Promise<void>
  listRecipes: () => Promise<RecipeSummary[]>
  getRecipe: (recipeId: string) => Promise<RecipeSummary | null>
  listProjects: () => Promise<ProjectListResult>
  getProject: (projectId: string) => Promise<ProjectSummary | null>
  createProject: (input: CreateProjectInput, ownerId?: string) => Promise<ProjectSummary>
  setProjectShared: (projectId: string, shared: boolean) => Promise<ProjectSummary>
  listSharedProjects: () => Promise<ProjectSummary[]>
  listProjectAssets: (projectId: string) => Promise<ProjectAssets>
  uploadProjectAsset: (input: UploadAssetInput) => Promise<ProjectAsset>
  getProjectAssetFile: (projectId: string, assetId: string) => Promise<ProjectAssetFile>
  deleteProjectAsset: (projectId: string, assetId: string) => Promise<ProjectAssets>
  getJob: (projectId: string) => Promise<JobSnapshot>
  startJob: (projectId: string, input: StartJobInput) => Promise<JobSnapshot>
  cancelJob: (projectId: string) => Promise<JobSnapshot>
  subscribeToJob: (projectId: string, listener: (event: JobEvent) => void) => () => void
  getAnalysis: (projectId: string) => Promise<AnalysisSnapshot>
  startAnalysis: (projectId: string, input: StartAnalysisInput) => Promise<AnalysisSnapshot>
  suggestCull: (projectId: string, input: { keep: number }) => Promise<AnalysisSnapshot>
  applyCull: (projectId: string) => Promise<AnalysisSnapshot>
  listProjectArtifacts: (projectId: string) => Promise<ProjectArtifact[]>
  getProjectArtifact: (projectId: string, artifactId: string) => Promise<ProjectArtifactFile>
  getTimeline: (projectId: string) => Promise<TimelineSnapshot>
  getTimelineImage: (projectId: string, sceneIndex: number, slotId: string) => Promise<TimelineImageFile>
  replaceTimelineImage: (projectId: string, input: ReplaceTimelineImageInput) => Promise<TimelineSnapshot>
  getRevisions: (projectId: string, maxRounds?: number) => Promise<RevisionSnapshot>
  previewRevision: (projectId: string, input: RevisionInput) => Promise<RevisionResult>
  applyRevision: (projectId: string, input: RevisionInput) => Promise<RevisionResult>
  undoRevision: (projectId: string, input: RevisionUndoInput) => Promise<RevisionResult>
  getDirector: (projectId: string) => Promise<DirectorState>
  generateDirector: (projectId: string, input: DirectorGenerateInput) => Promise<DirectorState>
  chooseDirectorStory: (projectId: string, input: DirectorStoryChoiceInput) => Promise<DirectorState>
  chooseDirectorMusic: (projectId: string, input: DirectorMusicChoiceInput) => Promise<DirectorState>
  getQa: (projectId: string) => Promise<QaSnapshot>
  getDelivery: (projectId: string) => Promise<DeliverySnapshot>
  approveDelivery: (projectId: string) => Promise<DeliverySnapshot>
  releaseDelivery: (projectId: string) => Promise<DeliverySnapshot>
  createCheckoutSession: (input: { userId: string; username: string; plan: PlanId; successUrl: string; cancelUrl: string }) => Promise<{ url: string }>
  handleWebhookEvent: (rawBody: Buffer, signature: string) => Promise<void>
  getPlanCatalog: () => ReturnType<typeof getPlanCatalog>
  listIncidents: () => { incidents: Incident[]; openCount: number }
  updateIncident: (id: string, status: IncidentStatus) => Incident | null
  retryIncident: (id: string) => Incident
}

const defaultServices: Services = {
  verifyLogin: (input) => verifyLogin(input.username, input.password),
  createUser: (input) => createUser(input.username, input.password),
  changePassword: (userId, input) => changePassword(userId, input.currentPassword, input.newPassword),
  createSession, deleteSession, getSession, getUserById, consumeRenderEntitlement,
  listRecipes, getRecipe, listProjects, getProject, createProject, setProjectShared, listSharedProjects, listProjectAssets, uploadProjectAsset, getProjectAssetFile, deleteProjectAsset,
  getJob: jobRunner.get, startJob: jobRunner.start, cancelJob: jobRunner.cancel, subscribeToJob: jobRunner.subscribe,
  getAnalysis: analysisService.get, startAnalysis: analysisService.start, suggestCull: analysisService.suggestCull, applyCull: analysisService.applyCull,
  listProjectArtifacts: artifactService.list, getProjectArtifact: artifactService.get,
  getTimeline: timelineService.get, getTimelineImage: timelineService.image, replaceTimelineImage: timelineService.replaceImage,
  getRevisions: revisionService.get, previewRevision: revisionService.preview, applyRevision: revisionService.apply, undoRevision: revisionService.undo,
  getDirector: directorService.get, generateDirector: directorService.generate, chooseDirectorStory: directorService.chooseStory, chooseDirectorMusic: directorService.chooseMusic,
  getQa: qaService.get,
  getDelivery: deliveryService.get, approveDelivery: deliveryService.approve, releaseDelivery: deliveryService.release,
  createCheckoutSession, handleWebhookEvent, getPlanCatalog,
  listIncidents: () => incidentService.list(),
  updateIncident: (id, status) => incidentService.update(id, status),
  retryIncident: (id) => incidentService.retry(id),
}
const checkoutInputSchema = z.object({ plan: z.enum(["subscription", "per_video"]) })
const resourceIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

function parseResourceId(encodedValue: string) {
  let value: string
  try { value = decodeURIComponent(encodedValue) } catch { throw new HttpError(400, "INVALID_RESOURCE_ID", "Resource id is not valid URL encoding") }
  const result = resourceIdSchema.safeParse(value)
  if (!result.success) throw new HttpError(400, "INVALID_RESOURCE_ID", "Resource id must use lowercase kebab-case")
  return result.data
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (origin && !config.webOrigins.has(origin)) {
    throw new HttpError(403, "ORIGIN_DENIED", "Request origin is not allowed")
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin)
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Range, Authorization")
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
  response.setHeader("Vary", "Origin")
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

async function requireSession(request: IncomingMessage, services: Services) {
  const token = bearerToken(request)
  if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Missing bearer token")
  const session = await services.getSession(token)
  if (!session) throw new HttpError(401, "UNAUTHENTICATED", "Invalid or expired session")
  return session
}

async function requireAdmin(session: { userId: string }, services: Services) {
  const user = await services.getUserById(session.userId)
  const admins = new Set((process.env.STOREEL_ADMIN_USERNAMES || "storeel").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))
  if (!user || !admins.has(user.username.toLowerCase())) throw new HttpError(403, "ADMIN_REQUIRED", "Administrator access is required")
}

function methodNotAllowed(response: ServerResponse) {
  response.setHeader("Allow", "GET, OPTIONS")
  sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET")
}

function sendArtifact(request: IncomingMessage, response: ServerResponse, artifact: ProjectArtifactFile) {
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Content-Type": artifact.mimeType,
    "Content-Disposition": `${artifact.id === "delivery" || artifact.kind === "json" ? "attachment" : "inline"}; filename="${artifact.filename.replace(/["\\]/g, "_")}"`,
  }
  const range = request.headers.range
  if (!range) {
    response.writeHead(200, { ...baseHeaders, "Content-Length": artifact.size! })
    createReadStream(artifact.absolutePath).pipe(response)
    return
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || (!match[1] && !match[2])) {
    response.writeHead(416, { "Content-Range": `bytes */${artifact.size}` })
    response.end()
    return
  }
  const size = artifact.size!
  const suffix = !match[1]
  const requestedStart = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1])
  const requestedEnd = suffix || !match[2] ? size - 1 : Number(match[2])
  const start = requestedStart
  const end = Math.min(requestedEnd, size - 1)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    response.writeHead(416, { "Content-Range": `bytes */${size}` })
    response.end()
    return
  }
  response.writeHead(206, { ...baseHeaders, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}` })
  createReadStream(artifact.absolutePath, { start, end }).pipe(response)
}

function sendTimelineImage(response: ServerResponse, image: TimelineImageFile) {
  response.writeHead(200, {
    "Cache-Control": "no-store", "Content-Type": image.mimeType, "Content-Length": image.size,
    "Content-Disposition": `inline; filename="${image.filename.replace(/["\\]/g, "_")}"`,
  })
  createReadStream(image.absolutePath).pipe(response)
}

async function routeRequest(request: IncomingMessage, response: ServerResponse, services: Services) {
  setCorsHeaders(request, response)

  if (request.method === "OPTIONS") {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url || "/", "http://localhost")

  if (url.pathname === "/api/health") {
    if (request.method !== "GET") return methodNotAllowed(response)
    sendJson(response, 200, {
      ok: true,
      data: {
        service: "storeel-api",
        status: "ok",
        version: config.version,
        timestamp: new Date().toISOString(),
      },
    })
    return
  }

  if (url.pathname === "/api/auth/login") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const input = await readJsonBody(request, loginInputSchema)
    const user = await services.verifyLogin(input)
    const token = await services.createSession(user.id)
    sendJson(response, 200, { ok: true, data: { token, user } })
    return
  }

  if (url.pathname === "/api/auth/register") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const input = await readJsonBody(request, registerInputSchema)
    const user = await services.createUser(input)
    const token = await services.createSession(user.id)
    sendJson(response, 201, { ok: true, data: { token, user } })
    return
  }

  if (url.pathname === "/api/auth/logout") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const token = bearerToken(request)
    if (token) await services.deleteSession(token)
    sendJson(response, 200, { ok: true, data: { loggedOut: true } })
    return
  }

  if (url.pathname === "/api/auth/me") {
    if (request.method !== "GET") return methodNotAllowed(response)
    const session = await requireSession(request, services)
    const user = await services.getUserById(session.userId)
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Session user no longer exists")
    sendJson(response, 200, { ok: true, data: { user } })
    return
  }

  if (url.pathname === "/api/auth/password") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const session = await requireSession(request, services)
    const input = await readJsonBody(request, changePasswordInputSchema)
    await services.changePassword(session.userId, input)
    sendJson(response, 200, { ok: true, data: { changed: true } })
    return
  }

  // Stripe calls this directly (no bearer token, no browser Origin) and
  // authenticates the request itself via the signed payload instead.
  if (url.pathname === "/api/billing/webhook") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const signature = request.headers["stripe-signature"]
    if (typeof signature !== "string") throw new HttpError(400, "MISSING_SIGNATURE", "Missing stripe-signature header")
    const rawBody = await readRawBody(request, 5 * 1024 * 1024)
    await services.handleWebhookEvent(rawBody, signature)
    sendJson(response, 200, { ok: true, data: { received: true } })
    return
  }

  let session: { userId: string } | null = null
  if (!url.pathname.startsWith("/api/gallery")) {
    session = await requireSession(request, services)
  }

  // Every /api/projects/:id/... sub-resource is gated here in one place so
  // each individual handler below doesn't need its own ownership check.
  // 404 (not 403) on mismatch so a caller can't distinguish "not yours" from
  // "doesn't exist."
  if (session) {
    const scopedProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/|$)/)
    if (scopedProjectMatch) {
      const scopedProjectId = parseResourceId(scopedProjectMatch[1])
      const scopedProject = await services.getProject(scopedProjectId)
      if (!scopedProject || scopedProject.ownerId !== session.userId) {
        throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${scopedProjectId}`)
      }
    }
  }

  // Public gallery — no session required. Only projects the owner has
  // explicitly shared are visible here, and only safe, non-internal fields
  // are returned (no status/error/pipeline details).
  if (url.pathname === "/api/gallery") {
    if (request.method !== "GET") return methodNotAllowed(response)
    const shared = await services.listSharedProjects()
    sendJson(response, 200, { ok: true, data: shared.map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt })) })
    return
  }

  const galleryVideoMatch = url.pathname.match(/^\/api\/gallery\/([^/]+)\/video$/)
  if (galleryVideoMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(galleryVideoMatch[1])
    const project = await services.getProject(projectId)
    if (!project || !project.shared) throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
    sendArtifact(request, response, await services.getProjectArtifact(projectId, "delivery"))
    return
  }

  if (url.pathname === "/api/billing/plans") {
    if (request.method !== "GET") return methodNotAllowed(response)
    sendJson(response, 200, { ok: true, data: services.getPlanCatalog() })
    return
  }

  if (url.pathname === "/api/admin/incidents") {
    if (request.method !== "GET") return methodNotAllowed(response)
    await requireAdmin(session!, services)
    sendJson(response, 200, { ok: true, data: services.listIncidents() })
    return
  }

  const adminIncidentMatch = url.pathname.match(/^\/api\/admin\/incidents\/([^/]+)$/)
  if (adminIncidentMatch) {
    if (request.method !== "PATCH") {
      response.setHeader("Allow", "PATCH, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports PATCH")
      return
    }
    await requireAdmin(session!, services)
    const input = await readJsonBody(request, updateIncidentSchema)
    const incident = services.updateIncident(decodeURIComponent(adminIncidentMatch[1]), input.status)
    if (!incident) throw new HttpError(404, "INCIDENT_NOT_FOUND", "Incident not found")
    sendJson(response, 200, { ok: true, data: incident })
    return
  }

  const retryIncidentMatch = url.pathname.match(/^\/api\/admin\/incidents\/([^/]+)\/retry$/)
  if (retryIncidentMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    await requireAdmin(session!, services)
    sendJson(response, 200, { ok: true, data: services.retryIncident(decodeURIComponent(retryIncidentMatch[1])) })
    return
  }

  if (url.pathname === "/api/billing/checkout") {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const input = await readJsonBody(request, checkoutInputSchema)
    const origin = request.headers.origin
    if (!origin || !config.webOrigins.has(origin)) throw new HttpError(400, "INVALID_ORIGIN", "Request Origin header is missing or not an allowed web origin")
    const user = await services.getUserById(session!.userId)
    if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Session user no longer exists")
    if (input.plan === "per_video" && user.plan.type === "subscription") {
      throw new HttpError(400, "ALREADY_SUBSCRIBED", "You already have an active subscription — use it instead of buying a single video")
    }
    const data = await services.createCheckoutSession({
      userId: user.id,
      username: user.username,
      plan: input.plan,
      successUrl: `${origin}/?view=dashboard&checkout=success`,
      cancelUrl: `${origin}/?view=dashboard&checkout=cancelled`,
    })
    sendJson(response, 200, { ok: true, data })
    return
  }

  if (url.pathname === "/api/recipes") {
    if (request.method !== "GET") return methodNotAllowed(response)
    sendJson(response, 200, { ok: true, data: await services.listRecipes() })
    return
  }

  const recipeMatch = url.pathname.match(/^\/api\/recipes\/([^/]+)$/)
  if (recipeMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const recipeId = parseResourceId(recipeMatch[1])
    const recipe = await services.getRecipe(recipeId)
    if (!recipe) throw new HttpError(404, "RECIPE_NOT_FOUND", `Recipe not found: ${recipeId}`)
    sendJson(response, 200, { ok: true, data: recipe })
    return
  }

  if (url.pathname === "/api/projects") {
    if (request.method === "GET") {
      const result = await services.listProjects()
      const mine = { ...result, projects: result.projects.filter((project) => project.ownerId === session!.userId) }
      sendJson(response, 200, { ok: true, data: mine })
      return
    }
    if (request.method === "POST") {
      const input = await readJsonBody(request, createProjectInputSchema)
      sendJson(response, 201, { ok: true, data: await services.createProject(input, session!.userId) })
      return
    }
    response.setHeader("Allow", "GET, POST, OPTIONS")
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET and POST")
    return
  }

  const projectAssetsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets$/)
  if (projectAssetsMatch) {
    const projectId = parseResourceId(projectAssetsMatch[1])
    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, data: await services.listProjectAssets(projectId) })
      return
    }
    if (request.method === "POST") {
      const filename = url.searchParams.get("filename")
      const kind = url.searchParams.get("kind")
      const uploadIndexValue = url.searchParams.get("uploadIndex")
      const uploadIndex = uploadIndexValue === null ? Number.NaN : Number(uploadIndexValue)
      if (!filename) throw new HttpError(400, "INVALID_FILENAME", "filename query parameter is required")
      const contentLengthHeader = request.headers["content-length"]
      const contentLength = typeof contentLengthHeader === "string" ? Number(contentLengthHeader) : undefined
      sendJson(response, 201, { ok: true, data: await services.uploadProjectAsset({
        projectId,
        kind: kind as UploadAssetInput["kind"],
        filename,
        uploadIndex,
        mimeType: request.headers["content-type"] || "",
        contentLength,
        body: request,
      }) })
      return
    }
    response.setHeader("Allow", "GET, POST, OPTIONS")
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET and POST")
    return
  }

  const projectAssetMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets\/([^/]+)$/)
  if (projectAssetMatch) {
    if (request.method !== "DELETE") {
      response.setHeader("Allow", "DELETE, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports DELETE")
      return
    }
    const projectId = parseResourceId(projectAssetMatch[1])
    const assetId = parseResourceId(projectAssetMatch[2])
    sendJson(response, 200, { ok: true, data: await services.deleteProjectAsset(projectId, assetId) })
    return
  }

  const projectAssetContentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/assets\/([^/]+)\/content$/)
  if (projectAssetContentMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(projectAssetContentMatch[1])
    const assetId = parseResourceId(projectAssetContentMatch[2])
    const asset = await services.getProjectAssetFile(projectId, assetId)
    response.writeHead(200, {
      "Content-Type": asset.mimeType,
      "Content-Length": asset.size,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="${asset.originalName.replace(/["\\\r\n]/g, "_")}"`,
    })
    createReadStream(asset.absolutePath).pipe(response)
    return
  }

  const projectJobEventsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/job\/events$/)
  if (projectJobEventsMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(projectJobEventsMatch[1])
    const initial = await services.getJob(projectId)
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    })
    const sendEvent = (event: JobEvent) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
    const unsubscribe = services.subscribeToJob(projectId, sendEvent)
    sendEvent({ type: "snapshot", data: initial })
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000)
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
      if (!response.writableEnded) response.end()
    }
    response.once("close", close)
    return
  }

  const projectArtifactMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/artifacts\/([^/]+)$/)
  if (projectArtifactMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(projectArtifactMatch[1])
    const artifactId = parseResourceId(projectArtifactMatch[2])
    sendArtifact(request, response, await services.getProjectArtifact(projectId, artifactId))
    return
  }

  const timelineImageMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/timeline\/images\/(\d+)\/([^/]+)$/)
  if (timelineImageMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(timelineImageMatch[1])
    const sceneIndex = Number(timelineImageMatch[2])
    const slotId = parseResourceId(timelineImageMatch[3])
    sendTimelineImage(response, await services.getTimelineImage(projectId, sceneIndex, slotId))
    return
  }

  const projectTimelineMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/timeline$/)
  if (projectTimelineMatch) {
    const projectId = parseResourceId(projectTimelineMatch[1])
    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, data: await services.getTimeline(projectId) })
      return
    }
    if (request.method === "PATCH") {
      const input = await readJsonBody(request, replaceTimelineImageSchema) as ReplaceTimelineImageInput
      sendJson(response, 200, { ok: true, data: await services.replaceTimelineImage(projectId, input) })
      return
    }
    response.setHeader("Allow", "GET, PATCH, OPTIONS")
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET and PATCH")
    return
  }

  const revisionActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/revisions\/(preview|apply|undo)$/)
  if (revisionActionMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const projectId = parseResourceId(revisionActionMatch[1])
    const action = revisionActionMatch[2]
    if (action === "undo") {
      const input = await readJsonBody(request, revisionUndoSchema) as RevisionUndoInput
      sendJson(response, 200, { ok: true, data: await services.undoRevision(projectId, input) })
      return
    }
    const input = await readJsonBody(request, revisionInputSchema) as RevisionInput
    sendJson(response, 200, { ok: true, data: action === "preview" ? await services.previewRevision(projectId, input) : await services.applyRevision(projectId, input) })
    return
  }

  const revisionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/revisions$/)
  if (revisionsMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(revisionsMatch[1])
    const maxRounds = Number(url.searchParams.get("maxRounds") || 2)
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) throw new HttpError(400, "INVALID_REVISION_BUDGET", "maxRounds must be an integer from 1 to 20")
    sendJson(response, 200, { ok: true, data: await services.getRevisions(projectId, maxRounds) })
    return
  }

  const directorActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/director\/(generate|story|music)$/)
  if (directorActionMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const projectId = parseResourceId(directorActionMatch[1])
    const action = directorActionMatch[2]
    if (action === "generate") {
      const input = await readJsonBody(request, directorGenerateSchema) as DirectorGenerateInput
      sendJson(response, 200, { ok: true, data: await services.generateDirector(projectId, input) })
      return
    }
    if (action === "story") {
      const input = await readJsonBody(request, directorStoryChoiceSchema) as DirectorStoryChoiceInput
      sendJson(response, 200, { ok: true, data: await services.chooseDirectorStory(projectId, input) })
      return
    }
    const input = await readJsonBody(request, directorMusicChoiceSchema) as DirectorMusicChoiceInput
    sendJson(response, 200, { ok: true, data: await services.chooseDirectorMusic(projectId, input) })
    return
  }

  const directorMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/director$/)
  if (directorMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    sendJson(response, 200, { ok: true, data: await services.getDirector(parseResourceId(directorMatch[1])) })
    return
  }

  const qaMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/qa$/)
  if (qaMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    sendJson(response, 200, { ok: true, data: await services.getQa(parseResourceId(qaMatch[1])) })
    return
  }

  const deliveryActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery\/(approve|release)$/)
  if (deliveryActionMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const projectId = parseResourceId(deliveryActionMatch[1])
    sendJson(response, 200, { ok: true, data: deliveryActionMatch[2] === "approve" ? await services.approveDelivery(projectId) : await services.releaseDelivery(projectId) })
    return
  }

  const deliveryMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/delivery$/)
  if (deliveryMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    sendJson(response, 200, { ok: true, data: await services.getDelivery(parseResourceId(deliveryMatch[1])) })
    return
  }

  const projectShareMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/share$/)
  if (projectShareMatch) {
    const projectId = parseResourceId(projectShareMatch[1])
    if (request.method === "POST") {
      const delivery = await services.getDelivery(projectId)
      if (!delivery.release) throw new HttpError(409, "PROJECT_NOT_RELEASED", "Release the delivery before sharing it publicly")
      sendJson(response, 200, { ok: true, data: await services.setProjectShared(projectId, true) })
      return
    }
    if (request.method === "DELETE") {
      sendJson(response, 200, { ok: true, data: await services.setProjectShared(projectId, false) })
      return
    }
    response.setHeader("Allow", "POST, DELETE, OPTIONS")
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST and DELETE")
    return
  }

  const projectArtifactsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/artifacts$/)
  if (projectArtifactsMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(projectArtifactsMatch[1])
    sendJson(response, 200, { ok: true, data: await services.listProjectArtifacts(projectId) })
    return
  }

  const applyCullMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/analysis\/cull\/apply$/)
  if (applyCullMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const projectId = parseResourceId(applyCullMatch[1])
    sendJson(response, 200, { ok: true, data: await services.applyCull(projectId) })
    return
  }

  const cullMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/analysis\/cull$/)
  if (cullMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const projectId = parseResourceId(cullMatch[1])
    const input = await readJsonBody(request, cullInputSchema) as { keep: number }
    sendJson(response, 200, { ok: true, data: await services.suggestCull(projectId, input) })
    return
  }

  const analysisMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/analysis$/)
  if (analysisMatch) {
    const projectId = parseResourceId(analysisMatch[1])
    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, data: await services.getAnalysis(projectId) })
      return
    }
    if (request.method === "POST") {
      const input = await readJsonBody(request, startAnalysisInputSchema) as StartAnalysisInput
      sendJson(response, 202, { ok: true, data: await services.startAnalysis(projectId, input) })
      return
    }
    response.setHeader("Allow", "GET, POST, OPTIONS")
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET and POST")
    return
  }

  const projectJobCancelMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/job\/cancel$/)
  if (projectJobCancelMatch) {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST, OPTIONS")
      sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports POST")
      return
    }
    const projectId = parseResourceId(projectJobCancelMatch[1])
    sendJson(response, 200, { ok: true, data: await services.cancelJob(projectId) })
    return
  }

  const projectJobMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/job$/)
  if (projectJobMatch) {
    const projectId = parseResourceId(projectJobMatch[1])
    if (request.method === "GET") {
      sendJson(response, 200, { ok: true, data: await services.getJob(projectId) })
      return
    }
    if (request.method === "POST") {
      const input = await readJsonBody(request, startJobInputSchema) as StartJobInput
      // dry_run is the free QA-proxy pass; only a real render consumes billing entitlement.
      if (input.mode === "render") await services.consumeRenderEntitlement(session!.userId)
      sendJson(response, 202, { ok: true, data: await services.startJob(projectId, input) })
      return
    }
    response.setHeader("Allow", "GET, POST, OPTIONS")
    sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET and POST")
    return
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/)
  if (projectMatch) {
    if (request.method !== "GET") return methodNotAllowed(response)
    const projectId = parseResourceId(projectMatch[1])
    const project = await services.getProject(projectId)
    if (!project) throw new HttpError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
    sendJson(response, 200, { ok: true, data: project })
    return
  }

  sendError(response, 404, "NOT_FOUND", `No route for ${request.method || "UNKNOWN"} ${url.pathname}`)
}

function handleFailure(response: ServerResponse, error: unknown) {
  if (response.headersSent) {
    response.end()
    return
  }
  if (error instanceof HttpError) {
    sendError(response, error.status, error.code, error.message, error.details)
    return
  }
  if (error instanceof AuthRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof ProjectAlreadyExistsError) {
    sendError(response, 409, "PROJECT_EXISTS", error.message)
    return
  }
  if (error instanceof UnknownRecipeError) {
    sendError(response, 400, "UNKNOWN_RECIPE", error.message)
    return
  }
  if (error instanceof AssetRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof JobRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof AnalysisRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof ArtifactRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof TimelineRequestError) {
    sendError(response, error.status, error.code, error.message, error.details)
    return
  }
  if (error instanceof RevisionRequestError) {
    sendError(response, error.status, error.code, error.message, error.details)
    return
  }
  if (error instanceof DirectorRequestError) {
    sendError(response, error.status, error.code, error.message, error.details)
    return
  }
  if (error instanceof QaRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof DeliveryRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof BillingRequestError) {
    sendError(response, error.status, error.code, error.message)
    return
  }
  if (error instanceof IncidentRequestError) {
    sendError(response, error.statusCode, error.code, error.message)
    return
  }
  if (error instanceof ZodError) {
    sendError(response, 500, "INVALID_SERVER_DATA", "Server data failed validation", error.issues)
    return
  }
  console.error("[storeel-api] unhandled request error", error)
  sendError(response, 500, "INTERNAL_ERROR", "The server could not complete the request")
}

export function createRequestHandler(overrides: Partial<Services> = {}) {
  const services = { ...defaultServices, ...overrides }
  return function handleRequest(request: IncomingMessage, response: ServerResponse) {
    void routeRequest(request, response, services).catch((error) => handleFailure(response, error))
  }
}
