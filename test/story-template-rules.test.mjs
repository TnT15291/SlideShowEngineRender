// Every story template must satisfy the authoring rules — the same gate
// scripts/lintStoryTemplates.mjs runs by hand. A template that fails here fails on
// every job it will ever run, so the failure belongs in CI, not in a customer render.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { evaluateStoryTemplate } from "../scripts/lib/rules/templateRules.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const dir = "story-templates";

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  test(`story template ${file} passes the authoring rules`, () => {
    const template = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const report = evaluateStoryTemplate(template, { library });
    const detail = report.errors.map((e) => `${e.check} [${e.id}] ${e.detail}`).join("\n  ");
    assert.equal(report.errors.length, 0, `authoring rule violations:\n  ${detail}`);
  });
}
