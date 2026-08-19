import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import { HttpError } from "../http.js"

/**
 * Keeps the repository's development soundtracks out of a customer's film.
 *
 * `music/` at the repo root holds commercial recordings used for local test
 * renders. Nothing in the web flow can reach them — `createProject` starts a
 * project with `music: []` and uploads land in `projects/<id>/music/` — but
 * `scripts/createProject.mjs --music music/Perfect.mp3` copies whatever it is
 * given straight into the project, and that copy is indistinguishable from an
 * upload by the time the renderer sees it. One operator shortcut on a real
 * order is all it takes to ship a film that gets claimed on YouTube.
 *
 * So the check is on content, not on filenames: a renamed copy is still the
 * same recording. Sizes are compared first, so the hash only runs for a file
 * that could actually be a match — on a normal order this costs one `stat`
 * per track.
 *
 * Set STOREEL_ALLOW_DEV_MUSIC=1 to render a test job with them anyway.
 */

const DEV_MUSIC_DIRECTORY = "music"

async function fileSha256(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

/** Sizes of the development tracks, mapped to the paths that have that size. */
async function devMusicBySize(engineRoot: string): Promise<Map<number, string[]>> {
  const bySize = new Map<number, string[]>()
  for (const file of await listFiles(path.resolve(engineRoot, DEV_MUSIC_DIRECTORY))) {
    const size = (await stat(file)).size
    bySize.set(size, [...(bySize.get(size) ?? []), file])
  }
  return bySize
}

/**
 * Throw if any track in this project is byte-identical to a development track.
 *
 * Runs before the render is charged for, alongside the other render
 * preconditions, so a blocked order costs the customer nothing.
 */
export async function assertLicensedMusic(projectId: string, engineRoot = process.cwd()): Promise<void> {
  if (process.env.STOREEL_ALLOW_DEV_MUSIC === "1") return

  const bySize = await devMusicBySize(engineRoot)
  if (bySize.size === 0) return

  const projectMusic = path.resolve(engineRoot, "projects", projectId, "music")
  for (const track of await listFiles(projectMusic)) {
    const candidates = bySize.get((await stat(track)).size)
    if (!candidates?.length) continue
    const trackHash = await fileSha256(track)
    for (const candidate of candidates) {
      if (await fileSha256(candidate) !== trackHash) continue
      throw new HttpError(
        409,
        "DEV_MUSIC_NOT_LICENSED",
        `"${path.basename(track)}" is one of the repository's test recordings, which are not licensed for delivery. Replace it with music the customer has the right to use.`,
        { track: path.basename(track) },
      )
    }
  }
}
