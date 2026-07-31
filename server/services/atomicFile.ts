import { mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

// Windows can refuse rename() onto a path something else has open at that
// exact instant — antivirus real-time scanning a freshly-written file, a
// concurrent reader (e.g. the job runner polls job-manifest.json every
// 300ms), a sync/indexing tool — EPERM/EBUSY, and it is almost always gone
// within milliseconds. POSIX rename has no such restriction, so this only
// ever fires on win32; retrying briefly costs nothing on POSIX since the
// error never happens there. scripts/lib/jobManifest.mjs hit exactly this
// once for real (a live render's job-manifest write raced the API server's
// poll of the same file) — same fix applies there in its own sync flavor.
const RENAME_RETRIES = 5
const RENAME_RETRY_DELAY_MS = 50

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isTransientWindowsLock(error: unknown): error is NodeJS.ErrnoException {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === "EPERM" || code === "EBUSY"
}

export async function writeTextAtomic(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, value, { encoding: "utf8", flag: "wx" })
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(temporary, file)
        return
      } catch (error) {
        if (attempt >= RENAME_RETRIES || !isTransientWindowsLock(error)) throw error
        await sleep(RENAME_RETRY_DELAY_MS * attempt)
      }
    }
  } finally {
    await rm(temporary, { force: true })
  }
}

export function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  return writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}
