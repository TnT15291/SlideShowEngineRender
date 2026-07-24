// THE RECEIPT. Cross-examine the finished film against everything the customer asked
// for, and say — in their own words — what was done and what was not.
//
// This is the node that turns the directive layer from a suggestion box into a
// director. Everything upstream can be persuaded, clamped and enforced, and still be
// wrong: a model drifts, a rebuild silently drops an act, a montage lands in the wrong
// place. So we do not ask the pipeline whether it obeyed. We ask the TIMELINE, which
// cannot lie about what it contains, and we hold that against the ledger.
//
// Three outcomes, and the third one is the whole point:
//   ✓ honoured    — evidenced in the timeline.
//   ✗ not honoured — evidenced NOT in the timeline. A `must` here fails the QA gate.
//   ? unverifiable — the timeline cannot prove this either way. NEVER counted as a win.
//     A green tick we cannot evidence is worse than no report at all.
//
// Exit: 0 all `must` directives honoured · 2 at least one broken (the QA gate) ·
//       1 error.  --report-only always exits 0 (write the receipt, judge nothing).
//
// Usage: node scripts/auditCompliance.mjs --timeline <tl.json> --directives <dir.json>
//        [--notes analysis/director_notes.json] [--plan analysis/story_plan.json]
//        [--content analysis/photo_content.json] [--out analysis/compliance.json] [--report-only]
import fs from "node:fs";
import path from "node:path";
import { loadLedger, active, audit, formatReport } from "./lib/directives.mjs";

const root = process.cwd();
const arg = (flag, def = "") => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const timelinePath = arg("--timeline");
const directivesPath = arg("--directives");
const notesPath = arg("--notes", "");
const planPath = arg("--plan", "");
const contentPath = arg("--content", "");
const outPath = arg("--out", "");
const reportOnly = process.argv.includes("--report-only");

if (!timelinePath || !directivesPath) {
  console.error("Usage: node scripts/auditCompliance.mjs --timeline <tl.json> --directives <ledger.json> [--out <compliance.json>]");
  process.exit(1);
}

const read = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const readIf = (p) => (p && fs.existsSync(path.resolve(root, p)) ? read(p) : null);

const timeline = read(timelinePath);
const ledger = loadLedger(directivesPath);
const orders = active(ledger);

// No orders is not a pass by default — it is a film nobody gave orders about, which
// is a perfectly good film. Say so plainly rather than printing an empty scorecard.
if (!orders.length && !(ledger.unmapped || []).length) {
  console.log(`[auditCompliance] the customer gave no instructions — nothing to hold the film to.`);
  if (outPath) {
    const abs = path.resolve(root, outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), timeline: timelinePath, total: 0, honored: 0, broken: 0, unverifiable: 0, pass: true, results: [], unmapped: [] }, null, 2) + "\n");
  }
  process.exit(0);
}

// `moment` directives are audited against CONTENT TAGS, not the timeline alone — build
// a filename -> tags lookup the same shape applyStoryTemplate's photo pool already has.
const contentDoc = readIf(contentPath);
const photoTags = contentDoc
  ? Object.fromEntries((contentDoc.photos || []).map((p) => [p.file, p.tags || []]))
  : null;

const report = audit(orders, timeline, {
  directorNotes: readIf(notesPath),
  storyPlan: readIf(planPath),
  photoTags,
});

const doc = {
  version: 1,
  generatedAt: new Date().toISOString(),
  timeline: timelinePath,
  directives: directivesPath,
  ...report,
  unmapped: ledger.unmapped || [],
};

if (outPath) {
  const abs = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(doc, null, 2) + "\n");
}

console.log(`\n[auditCompliance] ${path.basename(timelinePath)}`);
console.log(formatReport(report, ledger.unmapped || []));
if (outPath) console.log(`\n  -> ${outPath}`);

if (report.pass || reportOnly) {
  if (!report.pass) console.log(`\n  (--report-only: ${report.broken} broken directive(s) recorded, not enforced)`);
  process.exit(0);
}

// A `must` the film does not honour is not a warning. The customer told us to do a
// thing; the film does not do it. Stop, and name the words we broke.
console.error(`\n[auditCompliance] FAILED: ${report.broken} instruction(s) the film does not honour:`);
for (const r of report.results.filter((x) => x.strength === "must" && x.honored === false)) {
  console.error(`  ✗ ${JSON.stringify(r.quote)}\n      ${r.evidence}`);
}
process.exit(2);
