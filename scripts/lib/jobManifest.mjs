import fs from "node:fs";
import path from "node:path";
import { validate } from "./checkSchema.mjs";
import { root } from "./project.mjs";

const PHASES = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"];

// Windows can refuse rename() onto a path something else has open at that
// exact instant — antivirus real-time scanning the freshly-written file, the
// API server's 300ms poll of this same job-manifest.json — EPERM/EBUSY, and
// it is almost always gone within milliseconds. POSIX rename has no such
// restriction, so this only ever fires on win32. This whole tracker is
// synchronous by design (called throughout runProject.mjs's linear pipeline),
// so the backoff blocks the thread via Atomics.wait rather than spinning it.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from, to, attempts = 5, delayMs = 50) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= attempts || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      sleepSync(delayMs * attempt);
    }
  }
}

export function createJobTracker(project) {
  const manifestPath = project.abs(`${project.manifest.analysisDir}/job-manifest.json`);
  const schema = JSON.parse(fs.readFileSync(path.join(root, "schema", "job-manifest.schema.json"), "utf8"));
  const now = new Date().toISOString();
  const document = {
    schemaVersion: 1,
    projectId: project.manifest.id,
    status: "running",
    startedAt: now,
    updatedAt: now,
    phases: Object.fromEntries(PHASES.map((phase) => [phase, { status: "pending" }])),
    artifacts: {
      photos: `${project.manifest.analysisDir}/photos.json`,
      photoContent: `${project.manifest.analysisDir}/photo_content.json`,
      selection: project.manifest.selectedPhotos || `${project.manifest.analysisDir}/photos.selected.json`,
      story: project.manifest.story || `${project.manifest.analysisDir}/story-template.generated.json`,
      timeline: project.manifest.timeline,
      qaDir: `${project.manifest.analysisDir}/qa`,
      output: project.manifest.output,
      deliveryDir: "output/deliver"
    }
  };

  function write() {
    document.updatedAt = new Date().toISOString();
    const errors = validate(schema, document);
    if (errors.length) throw new Error(`Invalid job manifest:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const tempPath = `${manifestPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(document, null, 2) + "\n");
    renameWithRetry(tempPath, manifestPath);
  }

  return {
    path: manifestPath,
    document,
    initialize() {
      document.phases.validate = { status: "completed", startedAt: now, completedAt: now };
      write();
    },
    start(phase) {
      document.currentPhase = phase;
      document.phases[phase] = { status: "running", startedAt: new Date().toISOString() };
      write();
    },
    complete(phase) {
      document.phases[phase] = { ...document.phases[phase], status: "completed", completedAt: new Date().toISOString() };
      delete document.currentPhase;
      write();
    },
    skip(phase, reason) {
      document.phases[phase] = { status: "skipped", completedAt: new Date().toISOString(), reason };
      delete document.currentPhase;
      write();
    },
    fail(phase, error) {
      document.status = "failed";
      document.currentPhase = phase;
      document.phases[phase] = { ...document.phases[phase], status: "failed", completedAt: new Date().toISOString() };
      document.error = { phase, message: error.message || String(error) };
      if (Number.isInteger(error.exitCode) && error.exitCode > 0) document.error.exitCode = error.exitCode;
      write();
    },
    /** The customer's story-choice window is still open (node 4, exit 3). The job is
     *  not failed and not finished — it is waiting on a person. Recording it as
     *  "failed" would tell an operator to go fix something that is not broken. */
    pause(phase, reason) {
      document.status = "paused";
      document.currentPhase = phase;
      document.phases[phase] = { ...document.phases[phase], status: "pending", reason };
      write();
    },
    warn(warning) {
      document.warnings = [...(document.warnings || []), warning];
      write();
    },
    finish() {
      document.status = document.warnings?.length ? "completed_with_warning" : "completed";
      delete document.currentPhase;
      delete document.error;
      write();
    }
  };
}
