import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { isInside } from "./pathGuard.js"

const project = path.resolve("projects", "linh-nam")

test("a path beneath the project, or the project itself, is inside", () => {
  assert.equal(isInside(project, path.join(project, "output", "final.mp4")), true)
  assert.equal(isInside(project, project), true)
  assert.equal(isInside(project, path.join(project, "..notes")), true)
})

test("a path that climbs out of the project is not inside", () => {
  assert.equal(isInside(project, path.resolve(project, "..")), false)
  assert.equal(isInside(project, path.resolve(project, "..", "other", "timeline.json")), false)
  assert.equal(isInside(project, path.resolve(project, "..", "linh-nam-2")), false)
})

test("a path on another root is not inside", { skip: process.platform !== "win32" && "drive letters are Windows-only" }, () => {
  const otherDrive = project.toUpperCase().startsWith("C:") ? "D:\\x" : "C:\\x"
  assert.equal(isInside(project, otherDrive), false)
})
