import assert from "node:assert/strict"
import test from "node:test"

import { describeFailure, redactEnginePaths } from "./failureCause.js"

// Verbatim from a real failed run: a Silk Botanical project (18-photo minimum)
// started with three photos. This is the output a customer was shown as their
// explanation, stack trace and Windows paths included.
const REAL_BUILD_FAILURE = [
  "! file:///D:/Claude/Projects/SlideshowRenderEngine/scripts/applyStoryTemplate.mjs:752",
  "!     throw new Error(",
  "!     ^",
  "! Error: Global photo assignment could not fill: s01_save_the_date:strip_3",
  "!   3 requests demand 3 photo(s); the pool has 3, of which 1 are reserved for bookends — leaving 2. The shot list is over-drawn by 1.",
  "!     at file:///D:/Claude/Projects/SlideshowRenderEngine/scripts/applyStoryTemplate.mjs:752:9",
  "!     at ModuleJob.run (node:internal/modules/esm/module_job:430:25)",
  "! Node.js v24.14.0",
  "! [runProject] FAILED in build: recipe: jmii-silk-botanical-01.json failed (exit 1)",
]

test("the real over-drawn shot list is recognised, with its numbers", () => {
  const cause = describeFailure(REAL_BUILD_FAILURE)
  assert.deepEqual(cause, { code: "NOT_ENOUGH_PHOTOS", params: { pool: 3, short: 1 } })
})

test("each mapped engine failure is matched by the text the engine emits", () => {
  const cases: Array<[string, string]> = [
    ["Error: analysis/photos.selected.json has no photos", "PHOTOS_EMPTY"],
    ["Error: music analysis not found: analysis/music/Perfect.json. Run: node scripts/analyzeMusic.mjs", "MUSIC_NOT_ANALYSED"],
    ["Error: music analysis is stale or incomplete for \"Perfect.mp3\" (downbeats)", "MUSIC_NOT_ANALYSED"],
    ["FfmpegError: Failed to launch ffmpeg for scene 3: spawn ENOENT. Is FFmpeg installed / on PATH, or FFMPEG_PATH set?", "FFMPEG_MISSING"],
    ["Error: ENOSPC: no space left on device, write", "DISK_FULL"],
    ["FATAL ERROR: Reached heap limit — JavaScript heap out of memory", "OUT_OF_MEMORY"],
    ["Error: brief requires unavailable/excluded photo: 042.jpg", "BRIEF_WANTS_MISSING_PHOTO"],
  ]
  for (const [line, code] of cases) {
    assert.equal(describeFailure([line])?.code, code, line)
  }
})

test("an unrecognised failure stays unrecognised rather than being guessed at", () => {
  // The fallback shows the engine's own message; inventing a cause here would
  // send the customer to fix the wrong thing.
  assert.equal(describeFailure(["Error: something nobody has seen before"]), null)
  assert.equal(describeFailure([]), null)
})

test("the server's own filesystem never rides along with a failure", () => {
  const root = "D:\\Claude\\Projects\\SlideshowRenderEngine"
  const redacted = redactEnginePaths(REAL_BUILD_FAILURE.join("\n"), root)
  assert.ok(!redacted.includes("D:/Claude"), redacted)
  assert.ok(!redacted.includes("D:\\Claude"), redacted)
  assert.ok(!redacted.includes("file:///"), redacted)
  // What remains still identifies the file for a bug report.
  assert.ok(redacted.includes("scripts/applyStoryTemplate.mjs:752"), redacted)
  // And the sentence a customer needs is untouched.
  assert.ok(redacted.includes("The shot list is over-drawn by 1."), redacted)
})

test("redaction handles a posix root and a lowercase drive letter", () => {
  assert.equal(redactEnginePaths("at /srv/storeel/scripts/run.mjs:1", "/srv/storeel"), "at scripts/run.mjs:1")
  // Node reports the drive letter in either case depending on the API.
  assert.equal(redactEnginePaths("file:///d:/Engine/scripts/a.mjs", "D:\\Engine"), "scripts/a.mjs")
})

test("redaction leaves text that merely resembles a path alone", () => {
  assert.equal(redactEnginePaths("The shot list is over-drawn by 1.", "D:\\Engine"), "The shot list is over-drawn by 1.")
})
