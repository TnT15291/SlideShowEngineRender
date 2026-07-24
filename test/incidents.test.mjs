import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { recordIncident } from "../scripts/lib/incidents.mjs";

test("incident recorder deduplicates repeated open failures", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storeel-incident-recorder-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = {
    code: "CONTACT_SHEET_GENERATION_FAILED", projectId: "film-1", phase: "qa",
    message: "Contact sheet failed", technicalDetail: "frame missing", customerImpact: "Contact sheet unavailable",
  };
  const first = await recordIncident(input, root);
  const second = await recordIncident(input, root);
  assert.equal(second, first);

  const db = new DatabaseSync(path.join(root, "server", "data", "incidents.sqlite"));
  const row = db.prepare("SELECT occurrences FROM incidents WHERE id = ?").get(first);
  db.close();
  assert.equal(row.occurrences, 2);
});
