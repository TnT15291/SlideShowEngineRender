import path from "node:path"
import { mkdirSync } from "node:fs"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import { z } from "zod"

const statusSchema = z.enum(["new", "investigating", "resolved"])
export const updateIncidentSchema = z.object({ status: statusSchema })
export type IncidentStatus = z.infer<typeof statusSchema>
export type Incident = {
  id: string
  code: string
  projectId: string
  userId: string | null
  phase: string
  status: IncidentStatus
  message: string
  technicalDetail: string | null
  customerImpact: string
  occurrences: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export class IncidentRequestError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message) }
}

type IncidentRow = {
  id: string
  code: string
  project_id: string
  user_id: string | null
  phase: string
  status: IncidentStatus
  message: string
  technical_detail: string | null
  customer_impact: string
  occurrences: number
  created_at: string
  updated_at: string
  resolved_at: string | null
}

function open(engineRoot: string) {
  const directory = path.join(engineRoot, "server", "data")
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(path.join(directory, "incidents.sqlite"))
  db.exec(`CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, code TEXT NOT NULL, project_id TEXT NOT NULL,
    user_id TEXT, phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', message TEXT NOT NULL,
    technical_detail TEXT, customer_impact TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS incidents_status_updated ON incidents(status, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS incidents_open_fingerprint ON incidents(fingerprint) WHERE status != 'resolved';`)
  return db
}

function map(row: IncidentRow): Incident {
  return {
    id: row.id, code: row.code, projectId: row.project_id, userId: row.user_id, phase: row.phase,
    status: row.status, message: row.message, technicalDetail: row.technical_detail,
    customerImpact: row.customer_impact, occurrences: row.occurrences,
    createdAt: row.created_at, updatedAt: row.updated_at, resolvedAt: row.resolved_at,
  }
}

export function createIncidentService(engineRoot = process.cwd()) {
  return {
    /**
     * A folder under `projects/` whose manifest cannot be read.
     *
     * Nobody can own it (the owner id lives in the file that won't parse), so
     * it used to be broadcast to every signed-in customer as "1 project folder
     * can't be opened" — complete with the server-side path. It belongs here
     * instead, where an operator can act on it.
     *
     * Deliberately does not bump `occurrences` on an already-open incident:
     * the caller is the project-list route, which the dashboard polls, and a
     * counter climbing by one per poll would say nothing useful.
     */
    recordUnreadableProject(projectId: string, detail: string): void {
      const db = open(engineRoot)
      try {
        const fingerprint = createHash("sha256").update(`UNREADABLE_PROJECT_FOLDER|${projectId}|validate`).digest("hex")
        if (db.prepare("SELECT id FROM incidents WHERE fingerprint = ? AND status != 'resolved'").get(fingerprint)) return
        const now = new Date().toISOString()
        const id = `INC-${now.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`
        db.prepare(`INSERT INTO incidents
          (id, fingerprint, code, project_id, user_id, phase, message, technical_detail, customer_impact, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, fingerprint, "UNREADABLE_PROJECT_FOLDER", projectId, null, "validate",
            "A folder under projects/ has no readable project.json, so it can be neither opened nor attributed to an account.",
            detail, "None — the folder is hidden from every customer's project list.", now, now)
      } catch {
        // Observability must never break the list route that noticed it.
      } finally {
        db.close()
      }
    },
    list(): { incidents: Incident[]; openCount: number } {
      const db = open(engineRoot)
      try {
        const rows = db.prepare("SELECT * FROM incidents ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END, updated_at DESC").all() as unknown as IncidentRow[]
        const incidents = rows.map(map)
        return { incidents, openCount: incidents.filter((item) => item.status !== "resolved").length }
      } finally {
        db.close()
      }
    },
    update(id: string, status: IncidentStatus): Incident | null {
      const db = open(engineRoot)
      try {
        const now = new Date().toISOString()
        db.prepare("UPDATE incidents SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?")
          .run(status, now, status === "resolved" ? now : null, id)
        const row = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as unknown as IncidentRow | undefined
        return row ? map(row) : null
      } finally {
        db.close()
      }
    },
    retry(id: string): Incident {
      const db = open(engineRoot)
      try {
        const row = db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as unknown as IncidentRow | undefined
        if (!row) throw new IncidentRequestError(404, "INCIDENT_NOT_FOUND", "Incident not found")
        if (row.code !== "CONTACT_SHEET_GENERATION_FAILED") {
          throw new IncidentRequestError(409, "RETRY_NOT_SUPPORTED", `No safe step retry is registered for ${row.code}`)
        }
        const projectDir = path.resolve(engineRoot, "projects", row.project_id)
        if (path.dirname(projectDir) !== path.resolve(engineRoot, "projects")) throw new IncidentRequestError(400, "INVALID_PROJECT_ID", "Incident project id is invalid")
        const manifest = JSON.parse(readFileSync(path.join(projectDir, "project.json"), "utf8")) as { timeline: string; analysisDir: string }
        const timeline = path.relative(engineRoot, path.join(projectDir, manifest.timeline)).replaceAll("\\", "/")
        const analysis = path.relative(engineRoot, path.join(projectDir, manifest.analysisDir)).replaceAll("\\", "/")
        const result = spawnSync(process.execPath, ["scripts/generateContactSheet.mjs", timeline, "--analysis-dir", analysis],
          { cwd: engineRoot, encoding: "utf8", maxBuffer: 1 << 26 })
        if (result.status !== 0) throw new IncidentRequestError(409, "RETRY_FAILED", (result.stderr || result.stdout || "Contact sheet retry failed").trim().slice(-1000))
        const now = new Date().toISOString()
        db.prepare("UPDATE incidents SET status = 'resolved', updated_at = ?, resolved_at = ? WHERE id = ?").run(now, now, id)
        return map(db.prepare("SELECT * FROM incidents WHERE id = ?").get(id) as unknown as IncidentRow)
      } finally {
        db.close()
      }
    },
  }
}

export const incidentService = createIncidentService()
