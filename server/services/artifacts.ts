import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

const projectManifestSchema = z.object({
  id: z.string(),
  analysisDir: z.string().min(1),
  timeline: z.string().min(1),
  output: z.string().min(1),
}).passthrough()

const definitions = [
  { id: "timeline", label: "Timeline", kind: "json", mimeType: "application/json; charset=utf-8" },
  { id: "render", label: "Rendered film", kind: "video", mimeType: "video/mp4" },
  { id: "qa-report", label: "Rule-based QA", kind: "json", mimeType: "application/json; charset=utf-8" },
  { id: "preview", label: "Preview", kind: "video", mimeType: "video/mp4" },
  { id: "delivery", label: "Delivery master", kind: "video", mimeType: "video/mp4" },
  { id: "thumbnail", label: "Thumbnail", kind: "image", mimeType: "image/jpeg" },
  { id: "summary", label: "Project summary", kind: "json", mimeType: "application/json; charset=utf-8" },
] as const

export type ProjectArtifactId = (typeof definitions)[number]["id"]
export type ProjectArtifact = {
  id: ProjectArtifactId
  label: string
  kind: "video" | "image" | "json"
  mimeType: string
  ready: boolean
  stale: boolean
  size: number | null
  updatedAt: string | null
  url: string
}
export type ProjectArtifactFile = ProjectArtifact & { absolutePath: string; filename: string }

export class ArtifactRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

export function createArtifactService(engineRoot = process.cwd()) {
  const projectsRoot = path.resolve(engineRoot, "projects")

  async function resolveProject(projectId: string) {
    const projectDir = path.resolve(projectsRoot, projectId)
    if (path.dirname(projectDir) !== projectsRoot) throw new ArtifactRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    let manifest: z.infer<typeof projectManifestSchema>
    try {
      manifest = projectManifestSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ArtifactRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      throw new ArtifactRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
    if (manifest.id !== projectId) throw new ArtifactRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
    const timelineBase = path.basename(manifest.timeline, path.extname(manifest.timeline))
    const relativePaths: Record<ProjectArtifactId, string> = {
      timeline: manifest.timeline,
      render: manifest.output,
      "qa-report": path.join(manifest.analysisDir, "qa", `${timelineBase}.proxy.json`),
      preview: path.join("output", "deliver", "preview.mp4"),
      delivery: path.join("output", "deliver", "final.mp4"),
      thumbnail: path.join("output", "deliver", "thumbnail.jpg"),
      summary: path.join("output", "deliver", "project_summary.json"),
    }
    return { projectDir, relativePaths }
  }

  async function file(projectId: string, artifactId: string): Promise<ProjectArtifactFile> {
    const definition = definitions.find((candidate) => candidate.id === artifactId)
    if (!definition) throw new ArtifactRequestError(404, "ARTIFACT_NOT_FOUND", `Unknown project artifact: ${artifactId}`)
    const project = await resolveProject(projectId)
    const absolutePath = path.resolve(project.projectDir, project.relativePaths[definition.id])
    const relative = path.relative(project.projectDir, absolutePath)
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ArtifactRequestError(500, "INVALID_PROJECT_MANIFEST", `${definition.label} path escapes the project directory`)
    try {
      const metadata = await stat(absolutePath)
      if (!metadata.isFile()) throw new Error("not a file")
      let stale = false
      if (definition.id !== "timeline") {
        try {
          const timelineMetadata = await stat(path.resolve(project.projectDir, project.relativePaths.timeline))
          stale = metadata.mtimeMs < timelineMetadata.mtimeMs
        } catch { /* a missing timeline cannot make another artifact stale */ }
      }
      return {
        ...definition, ready: !stale, stale, size: metadata.size, updatedAt: metadata.mtime.toISOString(),
        url: `/projects/${projectId}/artifacts/${definition.id}`, absolutePath, filename: path.basename(absolutePath),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return {
        ...definition, ready: false, stale: false, size: null, updatedAt: null,
        url: `/projects/${projectId}/artifacts/${definition.id}`, absolutePath, filename: path.basename(absolutePath),
      }
    }
  }

  async function list(projectId: string): Promise<ProjectArtifact[]> {
    return Promise.all(definitions.map(async ({ id }) => {
      const { absolutePath: _absolutePath, filename: _filename, ...artifact } = await file(projectId, id)
      return artifact
    }))
  }

  async function get(projectId: string, artifactId: string) {
    const artifact = await file(projectId, artifactId)
    if (!artifact.ready) throw new ArtifactRequestError(404, "ARTIFACT_NOT_READY", `${artifact.label} is not ready`)
    return artifact
  }

  return { list, get }
}

export const artifactService = createArtifactService()
