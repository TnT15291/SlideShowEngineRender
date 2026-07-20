// Lint every story template against the authoring rules in lib/rules/templateRules.mjs.
//
// This is a CI/authoring gate, not per-job QA: a rule failing here fails on every job
// the recipe will ever run, so it is fixed in the recipe file, once.
//
// Usage:
//   node scripts/lintStoryTemplates.mjs                 # lint story-templates/*.json
//   node scripts/lintStoryTemplates.mjs --template story-templates/warm-film-01.json
//
// Exit code 1 when any template has errors — wire it into the test run.
import fs from "node:fs";
import path from "node:path";
import { evaluateStoryTemplate } from "./lib/rules/templateRules.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const libraryPath = arg("--library", "layouts/library.json");
const library = JSON.parse(fs.readFileSync(path.resolve(root, libraryPath), "utf8"));

const single = arg("--template", "");
const dir = arg("--templates", "story-templates");
const files = single
  ? [single]
  : fs.readdirSync(path.resolve(root, dir)).filter((f) => f.endsWith(".json"))
      .map((f) => path.join(dir, f));

let failed = 0;
let clean = 0;
for (const file of files) {
  const template = JSON.parse(fs.readFileSync(path.resolve(root, file), "utf8"));
  const report = evaluateStoryTemplate(template, { library });
  if (report.verdict === "pass") { clean++; continue; }
  console.log(`\n${template.id ?? file} — ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  for (const f of report.errors) console.log(`  ERROR ${f.check} [${f.id}] ${f.detail}`);
  for (const f of report.warnings) console.log(`  warn  ${f.check} [${f.id}] ${f.detail}`);
  if (report.errors.length) failed++;
}

console.log(`\n[lintStoryTemplates] ${files.length} template(s): ${clean} clean, ${failed} failing.`);
process.exit(failed ? 1 : 0);
