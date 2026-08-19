import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { HttpError } from "../http.js"
import { assertLicensedMusic } from "./musicProvenance.js"

const DEV_TRACK = "a fake commercial recording, byte for byte"

async function workspace(context: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-music-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, "music"), { recursive: true })
  await mkdir(path.join(root, "projects", "linh-nam", "music"), { recursive: true })
  await writeFile(path.join(root, "music", "Perfect.mp3"), DEV_TRACK)
  return root
}

function projectTrack(root: string, name: string) {
  return path.join(root, "projects", "linh-nam", "music", name)
}

test("a project carrying a copy of a development track is refused before it can be charged for", async (context) => {
  const root = await workspace(context)
  await writeFile(projectTrack(root, "our-song.mp3"), DEV_TRACK)

  await assert.rejects(
    assertLicensedMusic("linh-nam", root),
    (error: unknown) => error instanceof HttpError
      && error.status === 409
      && error.code === "DEV_MUSIC_NOT_LICENSED"
      // Renaming the file does not disguise it — the check is on content, and
      // the message names the file the operator actually has to replace.
      && error.message.includes("our-song.mp3"),
  )
})

test("music the customer supplied passes, including a file that only matches a dev track in size", async (context) => {
  const root = await workspace(context)
  await writeFile(projectTrack(root, "their-own.mp3"), "something the couple actually licensed")
  // Same length as DEV_TRACK, different bytes: the size index says "look
  // closer", the hash says "not the same recording". Both have to be exercised
  // or the cheap pre-filter could be hiding a broken comparison.
  await writeFile(projectTrack(root, "same-length.mp3"), "X".repeat(DEV_TRACK.length))

  await assertLicensedMusic("linh-nam", root)
})

test("the check is skipped for a project with no music, and for an engine with no dev music folder", async (context) => {
  const root = await workspace(context)
  await assertLicensedMusic("linh-nam", root)

  const bare = await mkdtemp(path.join(os.tmpdir(), "storeel-music-bare-"))
  context.after(() => rm(bare, { recursive: true, force: true }))
  await assertLicensedMusic("linh-nam", bare)
})

test("STOREEL_ALLOW_DEV_MUSIC lets an operator render a test job with them anyway", async (context) => {
  const root = await workspace(context)
  await writeFile(projectTrack(root, "Perfect.mp3"), DEV_TRACK)

  const previous = process.env.STOREEL_ALLOW_DEV_MUSIC
  process.env.STOREEL_ALLOW_DEV_MUSIC = "1"
  context.after(() => {
    if (previous === undefined) delete process.env.STOREEL_ALLOW_DEV_MUSIC
    else process.env.STOREEL_ALLOW_DEV_MUSIC = previous
  })

  await assertLicensedMusic("linh-nam", root)

  // Only the exact opt-in value counts; a stray "0" or "false" must not read
  // as permission to ship a claimed soundtrack.
  process.env.STOREEL_ALLOW_DEV_MUSIC = "0"
  await assert.rejects(
    assertLicensedMusic("linh-nam", root),
    (error: unknown) => error instanceof HttpError && error.code === "DEV_MUSIC_NOT_LICENSED",
  )
})
