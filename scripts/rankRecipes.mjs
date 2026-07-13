import fs from "node:fs";
import path from "node:path";
import { aggregateFeedback } from "./lib/feedbackLedger.mjs";
const root = process.cwd(), arg = (flag, def = "") => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const projectsDir = path.resolve(root, arg("--projects", "projects")), out = arg("--out", "analysis/recipe-ranking.json");
const files = [];
if (fs.existsSync(projectsDir)) for (const name of fs.readdirSync(projectsDir)) { const p = path.join(projectsDir, name, "analysis", "feedback.jsonl"); if (fs.existsSync(p)) files.push(p); }
const rootLedger = path.resolve(root, "analysis/feedback.jsonl"); if (fs.existsSync(rootLedger)) files.push(rootLedger);
const events = files.flatMap((file) => fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }));
const ranking = aggregateFeedback(events), doc = { version: 1, generatedAt: new Date().toISOString(), privacy: "anonymous local aggregate; no image paths or customer replies", ledgers: files.length, events: events.length, ranking };
fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true }); fs.writeFileSync(path.resolve(root, out), JSON.stringify(doc, null, 2) + "\n");
console.log(`Recipe ranking: ${ranking.length} recipe/pacing rows from ${events.length} event(s) -> ${out}`);
