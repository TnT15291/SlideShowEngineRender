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

test("incident recorder sends one Slack alert for a repeated open failure", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "storeel-slack-recorder-"));
  const originalFetch = globalThis.fetch;
  const originalWebhook = process.env.STOREEL_SLACK_WEBHOOK_URL;
  const requests = [];
  process.env.STOREEL_SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/test";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), payload: JSON.parse(init.body) });
    return new Response("ok", { status: 200 });
  };
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.STOREEL_SLACK_WEBHOOK_URL;
    else process.env.STOREEL_SLACK_WEBHOOK_URL = originalWebhook;
  });
  const input = {
    code: "PIPELINE_RENDER_FAILED", projectId: "film-2", phase: "render",
    message: "Render failed", technicalDetail: "exit 1", customerImpact: "Video was not completed.",
  };
  await recordIncident(input, root);
  await recordIncident(input, root);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, process.env.STOREEL_SLACK_WEBHOOK_URL);
  assert.match(requests[0].payload.text, /PIPELINE_RENDER_FAILED/);
  assert.doesNotMatch(requests[0].payload.text, /exit 1/);
});
