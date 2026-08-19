import { mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { writeJsonAtomic } from "./atomicFile.js"
import { withLock } from "./fileLock.js"
import { refundRenderEntitlement } from "./auth.js"
import type { JobStatus } from "./jobs.js"

/**
 * One render credit per film, held open until that film either exists or is
 * abandoned.
 *
 * Before this, `POST /api/projects/:id/job` charged unconditionally on every
 * call. That billed three separate ways a customer never agreed to:
 *
 *  - a run that failed in `build`, before a frame was rendered, kept the credit
 *  - the "Try again" button the failure screen offers charged again
 *  - `resume: true` (which the web client always sends) meant simply continuing
 *    a paused job — a music-fit confirmation, say — charged a second time
 *
 * A reservation file beside the job manifest fixes all three: the charge
 * happens once when a reservation is opened, resuming reuses the open one, and
 * settling a failed run hands the credit back exactly once. Persisting it (as
 * opposed to holding it in memory) is what makes a server restart mid-render
 * still refund correctly — the next snapshot read settles it.
 */
const reservationSchema = z.object({
  projectId: z.string(),
  userId: z.string(),
  reservedAt: z.string(),
})

export type RenderReservation = z.infer<typeof reservationSchema>

function reservationFile(engineRoot: string, projectId: string) {
  return path.join(engineRoot, "projects", projectId, "render-billing.json")
}

async function read(engineRoot: string, projectId: string): Promise<RenderReservation | null> {
  try {
    return reservationSchema.parse(JSON.parse(await readFile(reservationFile(engineRoot, projectId), "utf8")))
  } catch {
    // Missing is the normal case; malformed is treated the same, because the
    // safe failure mode for a billing hold is "no hold" — a stray refund would
    // mint credits, a missed one is recoverable by support.
    return null
  }
}

/** The open hold for this project, if the same user still owns it. */
export async function findOpenReservation(projectId: string, userId: string, engineRoot = process.cwd()): Promise<RenderReservation | null> {
  const reservation = await read(engineRoot, projectId)
  return reservation && reservation.userId === userId ? reservation : null
}

export async function reserveRender(projectId: string, userId: string, engineRoot = process.cwd()): Promise<void> {
  const file = reservationFile(engineRoot, projectId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeJsonAtomic(file, { projectId, userId, reservedAt: new Date().toISOString() } satisfies RenderReservation)
}

/**
 * Close the hold for a job that has reached a terminal state.
 *
 * `failed` refunds; a delivered film keeps the charge. `running`, `pending`,
 * `queued` and `paused` are deliberately no-ops — a paused job is one the
 * customer is expected to resume, and resuming must not cost a second credit.
 *
 * The allow-list below is what keeps that true as states are added: `queued`
 * (G2.6) arrives on every snapshot poll while an order waits for a render
 * slot, and a deny-list would have refunded the credit out from under it.
 *
 * Idempotent by construction: the refund and the deletion of the hold happen
 * under the same lock, so two concurrent settles cannot both refund.
 */
export async function settleRender(projectId: string, status: JobStatus, engineRoot = process.cwd()): Promise<boolean> {
  if (status !== "failed" && status !== "completed" && status !== "completed_with_warning") return false
  const file = reservationFile(engineRoot, projectId)
  return withLock(file, async () => {
    const reservation = await read(engineRoot, projectId)
    if (!reservation) return false
    if (status === "failed") await refundRenderEntitlement(reservation.userId, engineRoot)
    await rm(file, { force: true })
    return status === "failed"
  })
}

/** Drop a hold without refunding — used when a project is deleted outright. */
export async function releaseReservation(projectId: string, engineRoot = process.cwd()): Promise<void> {
  await rm(reservationFile(engineRoot, projectId), { force: true })
}
