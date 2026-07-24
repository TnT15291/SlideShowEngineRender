import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { createIncidentService, IncidentRequestError } from "./incidents.js"

test("incident service lists open incidents and tracks resolution", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-incidents-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  const service = createIncidentService(root)
  assert.deepEqual(service.list(), { incidents: [], openCount: 0 })

  const database = new DatabaseSync(path.join(root, "server", "data", "incidents.sqlite"))
  database.prepare(`INSERT INTO incidents
    (id, fingerprint, code, project_id, phase, message, customer_impact, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("INC-1", "fingerprint", "RENDER_FAILED", "test-project", "render", "Render failed", "Video unavailable", "2026-01-01", "2026-01-01")
  database.close()

  assert.equal(service.list().openCount, 1)
  assert.throws(() => service.retry("INC-1"), (error) => error instanceof IncidentRequestError && error.code === "RETRY_NOT_SUPPORTED")
  const investigating = service.update("INC-1", "investigating")
  assert.equal(investigating?.status, "investigating")
  assert.equal(service.update("INC-1", "resolved")?.status, "resolved")
  assert.equal(service.list().openCount, 0)
  assert.equal(service.update("missing", "resolved"), null)
})
