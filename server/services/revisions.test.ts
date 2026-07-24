import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createRevisionService, RevisionRequestError } from "./revisions.js"

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-revisions-"))
  const project = path.join(root, "projects", "sample")
  await mkdir(path.join(project, "analysis"), { recursive: true })
  await writeFile(path.join(project, "project.json"), JSON.stringify({ id: "sample", analysisDir: "analysis" }))
  await writeFile(path.join(project, "directives.json"), JSON.stringify({ version: 1, directives: [{ id: "r0", round: 0, quote: "original", kind: "pacing", op: "prefer", target: "gentle" }] }))
  await writeFile(path.join(project, "analysis", "job-manifest.json"), JSON.stringify({ status: "completed", phases: { render: { status: "completed" } } }))
  const script = path.join(root, "revision-stub.mjs")
  await writeFile(script, `
import fs from "node:fs"; import path from "node:path";
const args = process.argv.slice(2), has = (x) => args.includes(x), value = (x) => args[args.indexOf(x) + 1];
if ((value("--request") || "").includes("budget")) { console.error("revision budget spent"); process.exit(5); }
console.log("[reviseProject] round 1: 1 change(s), blast radius = " + ((value("--request") || "").includes("story") ? "plan" : "build"));
if ((value("--request") || "").includes("story")) console.log("This is a RE-TELLING, confirm-restory");
if (has("--preview")) { console.log("PREVIEW — nothing was written.\\n- scene 4 exact lost text: \\"Forever\\"\\n⚠ THIS DESTROYS WORK"); process.exit(0); }
const project = path.resolve(value("--project"));
fs.writeFileSync(path.join(project, "directives.json"), JSON.stringify({version:1,directives:[{id:"r1",round:1,quote:value("--request") || "undo",kind:"layout",op:"prefer",target:"montage"}]}));
const job = path.join(project, "analysis", "job-manifest.json"); const doc = JSON.parse(fs.readFileSync(job)); doc.status="running"; fs.writeFileSync(job, JSON.stringify(doc));
console.log("re-entering at: build");
`)
  return { root, project, service: createRevisionService(root, script) }
}

test("revision service previews exact CLI diff without mutating the ledger", async (context) => {
  const { root, project, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  const before = await readFile(path.join(project, "directives.json"), "utf8")
  const result = await service.preview("sample", { request: "use montage", maxRounds: 2 })
  assert.equal(result.blastRadius, "build"); assert.equal(result.destructive, true)
  assert.match(result.output, /exact lost text/); assert.equal(await readFile(path.join(project, "directives.json"), "utf8"), before)
})

test("revision service records history and leaves invalidated jobs paused", async (context) => {
  const { root, project, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  const result = await service.apply("sample", { request: "use montage", maxRounds: 2 })
  assert.equal(result.snapshot.rounds[0].directives[0].quote, "use montage")
  assert.equal(JSON.parse(await readFile(path.join(project, "analysis", "job-manifest.json"), "utf8")).status, "paused")
})

test("revision service maps budget failures to a stable API error", async (context) => {
  const { root, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(() => service.preview("sample", { request: "budget", maxRounds: 2 }), (error: unknown) => error instanceof RevisionRequestError && error.code === "REVISION_BUDGET_EXCEEDED")
})
