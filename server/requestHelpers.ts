import { createReadStream } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"

import { z } from "zod"

import { config } from "./config.js"
import { HttpError, sendError } from "./http.js"
import type { ProjectArtifactFile } from "./services/artifacts.js"
import type { TimelineImageFile } from "./services/timeline.js"

const resourceIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export function parseResourceId(encodedValue: string) {
  let value: string
  try { value = decodeURIComponent(encodedValue) } catch { throw new HttpError(400, "INVALID_RESOURCE_ID", "Resource id is not valid URL encoding") }
  const result = resourceIdSchema.safeParse(value)
  if (!result.success) throw new HttpError(400, "INVALID_RESOURCE_ID", "Resource id must use lowercase kebab-case")
  return result.data
}

export function setCorsHeaders(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin
  if (origin && !config.webOrigins.has(origin)) {
    throw new HttpError(403, "ORIGIN_DENIED", "Request origin is not allowed")
  }
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin)
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Range, Authorization")
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
  response.setHeader("Vary", "Origin")
}

export function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1].trim() : null
}

export function methodNotAllowed(response: ServerResponse) {
  response.setHeader("Allow", "GET, OPTIONS")
  sendError(response, 405, "METHOD_NOT_ALLOWED", "This endpoint only supports GET")
}

export function sendArtifact(request: IncomingMessage, response: ServerResponse, artifact: ProjectArtifactFile) {
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

export function sendTimelineImage(response: ServerResponse, image: TimelineImageFile) {
  response.writeHead(200, {
    "Cache-Control": "no-store", "Content-Type": image.mimeType, "Content-Length": image.size,
    "Content-Disposition": `inline; filename="${image.filename.replace(/["\\]/g, "_")}"`,
  })
  createReadStream(image.absolutePath).pipe(response)
}
