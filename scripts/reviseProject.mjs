// THE REVISION LOOP. The customer has seen a preview and wants something changed.
//
// Nobody can describe an effect they have not seen yet. Demanding the whole brief up
// front is asking the customer to art-direct a film that does not exist. So the real
// product is: build it, show it, and let them say what to change — which makes THIS
// the node where most of the customer's direction actually arrives.
//
// THE BLAST RADIUS IS THE WHOLE SAFETY PROPERTY.
//
// A revision is applied at the LOWEST phase that can satisfy it, and only the phases
// below that one re-run:
//
//   timeline — "bỏ chữ ở cảnh 12". Patched straight into timeline.json. No rebuild, no
//              AI call. Critically: premium's build re-runs the COPYWRITER, so routing
//              a text tweak through it would rewrite the very words the customer just
//              approved. The cheap path is not an optimisation, it is a correctness
//              requirement.
//   build    — "đổi sang lật trang phim", "chậm lại", "bỏ tấm này". Storyboard and
//              timeline are rebuilt from the SAME story. Still zero AI calls.
//   plan     — "kể lại theo trình tự khác", "đổi hẳn câu chuyện". This re-runs the
//              story nodes, and node 3 pitches at temperature 0.7: the film that comes
//              back is a DIFFERENT FILM. That is a legitimate thing to ask for and an
//              illegitimate thing to do by accident, so it is the one radius that
//              demands --confirm-restory. Everything else is safe by construction.
//
// DIRECTIVES ACCUMULATE. Round 2 does not replace round 1 — it is appended, and the
// audit at the end holds the film to ALL of them. Without a ledger, each revision is a
// fresh model call that quietly forgets the last one, which is the classic way these
// tools hand you back a fixed scene 12 and a broken scene 4.
//
// Exit: 0 applied · 4 needs --confirm-restory · 5 revision budget spent · 1 error.
//
// Usage:
//   node scripts/reviseProject.mjs --project <dir> --request "đoạn bạn bè dùng lật trang phim"
//   node scripts/reviseProject.mjs --project <dir> --request-file reply.txt [--run]
//   ... [--confirm-restory] [--max-rounds 2] [--force]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasKey, callDeepSeekJSON } from "./lib/deepseek.mjs";
import { extractDirectives } from "./lib/briefRules.mjs";
import {
  validateDirective, loadLedger, saveLedger, appendRound, active,
  blastRadius, widestRadius, applyToTimeline,
  EFFECTS, TRANSITIONS, CURVES, OVERLAYS, PACING, ACTS, ROLES,
} from "./lib/directives.mjs";
import { arg, loadProject, root } from "./lib/project.mjs";
import { revisionInvalidation, invalidateApproval } from "./lib/revisionInvalidation.mjs";

const has = (flag) => process.argv.includes(flag);
const die = (msg) => { console.error(`[reviseProject] FAILED: ${msg}`); process.exit(1); };

const projectArg = arg("--project");
const project = loadProject(projectArg);
const requestFile = arg("--request-file", "");
const maxRounds = Number(arg("--max-rounds", "2"));
const confirmRestory = has("--confirm-restory");
const force = has("--force");
const doRun = has("--run");

const request = (arg("--request", "") || (requestFile ? fs.readFileSync(path.resolve(root, requestFile), "utf8") : "")).trim();
if (!request) die(`nothing to do: pass --request "<what to change>" or --request-file <file>`);

const ledgerPath = project.rel("directives.json");
const timelinePath = project.rel(project.manifest.timeline);
const manifestPath = project.abs(`${project.manifest.analysisDir}/job-manifest.json`);

// ---------------------------------------------------------------------------
// 1. Compile the request. A revision is PURE IMPERATIVE — there is no story half.
// ---------------------------------------------------------------------------
function buildSystem() {
  return [
    "A customer has watched a preview of their wedding slideshow and is asking for changes.",
    "Turn their message into a list of directives. Nothing else — there is no story to retell here, only changes to make.",
    "",
    "A directive is only valid if you can QUOTE their own words for it. Never invent a change they did not ask for.",
    "If they ask for something this engine cannot do, put it in `unmapped` with a reason. Do NOT substitute the",
    "nearest thing you can do: they will watch the next cut expecting what they asked for.",
    "",
    "Each directive is: {quote, kind, op, scope, target, strength, confidence}",
    "  kind   : effect | transition | color | overlay | pacing | duration | caption | photo | structure | story",
    "  op     : set | forbid | require",
    '  scope  : {"global":true} | {"act":ACT} | {"scene":"s07"} | {"role":ROLE}',
    '  strength: "must" | "prefer"',
    "",
    `ACT  is one of: ${ACTS.join(", ")}`,
    `ROLE is one of: ${ROLES.join(", ")}`,
    "",
    "target MUST be an exact string from the engine's vocabulary:",
    `  effect     : ${[...EFFECTS].join(", ")}`,
    `  transition : ${[...TRANSITIONS].join(", ")}`,
    `  color      : ${[...CURVES].join(", ")}, none`,
    `  overlay    : ${[...OVERLAYS].join(", ")}`,
    `  pacing     : ${[...PACING].join(", ")}`,
    "  duration   : a NUMBER of seconds.   caption: the exact text for op=set, else null.   photo: a filename.",
    "",
    "Use kind=structure or kind=story ONLY if they want the film RE-TOLD (different order, different narrative).",
    "Asking to change a look, an effect, a length or some words is NOT a story change.",
    "",
    'Return ONE JSON object: {"directives":[...], "unmapped":[{"quote":str,"reason":str}]}',
  ].join("\n");
}

const ruleHits = extractDirectives(request);
let raw;
if (hasKey()) {
  process.stdout.write("  DeepSeek revision-compile call... ");
  raw = await callDeepSeekJSON({ system: buildSystem(), user: `Their message:\n\n${request}\n\nCompile it now.`, temperature: 0.1 });
  console.log("ok");
} else {
  raw = {
    directives: ruleHits.filter((d) => !d.__unmapped),
    unmapped: ruleHits.filter((d) => d.__unmapped).map(({ quote, reason }) => ({ quote, reason })),
  };
}

const incoming = [];
const unmapped = [];
(Array.isArray(raw.directives) ? raw.directives : []).forEach((d, i) => {
  const r = validateDirective(d, i);
  if (r.ok) incoming.push(r.directive);
  else unmapped.push({ quote: r.quote || JSON.stringify(d).slice(0, 120), reason: r.reason });
});
for (const u of Array.isArray(raw.unmapped) ? raw.unmapped : []) {
  if (u?.quote) unmapped.push({ quote: String(u.quote).slice(0, 300), reason: String(u.reason || "the engine has no way to do this").slice(0, 240) });
}

if (!incoming.length) {
  console.error(`[reviseProject] nothing in that message maps to something this engine can change.`);
  for (const u of unmapped) console.error(`  ✗ ${JSON.stringify(u.quote)} — ${u.reason}`);
  console.error(`\n  Nothing was changed. Ask them to be more specific, or say plainly that we cannot do it.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. The gates: revision budget, and the one radius that can change the film.
// ---------------------------------------------------------------------------
const ledger = loadLedger(ledgerPath);
const round = Math.max(0, ...ledger.directives.map((d) => d.round ?? 0)) + 1;

if (round > maxRounds && !force) {
  console.error(
    `[reviseProject] revision budget spent: this would be round ${round}, and the job allows ${maxRounds}.\n` +
      `  Rounds are capped for the same reason QA's repair loop is: an unbounded revise loop is how a job\n` +
      `  never ships. Pass --force to grant another round, or --max-rounds N to change the deal.`
  );
  process.exit(5);
}

const radius = widestRadius(incoming);
if (radius === "plan" && !confirmRestory) {
  const restory = incoming.filter((d) => blastRadius(d) === "plan");
  console.error(
    `[reviseProject] this is not a revision — it is a re-telling.\n\n` +
      restory.map((d) => `    ${JSON.stringify(d.quote)}`).join("\n") +
      `\n\n  Honouring it re-runs the story nodes, which pitch at temperature 0.7. The film that comes back\n` +
      `  will NOT be the film they approved — different acts, different words, possibly different photos.\n` +
      `  That may be exactly what they want. It must not happen because nobody noticed.\n\n` +
      `  Re-run with --confirm-restory if they understand they are getting a new cut.`
  );
  process.exit(4);
}

// ---------------------------------------------------------------------------
// 3. Append. Never overwrite: the ledger is the only thing that stops round 2
//    from silently undoing round 1.
// ---------------------------------------------------------------------------
const next = appendRound(ledger, incoming, round);
next.unmapped = [...(ledger.unmapped || []), ...unmapped.map((u) => ({ ...u, round }))];
saveLedger(ledgerPath, next);

const superseded = next.directives.filter((d) => d.supersededBy === round);

console.log(`\n[reviseProject] round ${round}: ${incoming.length} change(s), blast radius = ${radius}`);
for (const d of incoming) {
  const where = d.scope.act ? `act ${d.scope.act}` : d.scope.scene ? `scene ${d.scope.scene}` : d.scope.role ? `${d.scope.role} shots` : "the whole film";
  console.log(`  • ${d.kind}/${d.op} ${JSON.stringify(d.target)} @ ${where}  [${blastRadius(d)}]`);
  console.log(`      ${JSON.stringify(d.quote)}`);
}
for (const u of unmapped) console.log(`  ✗ CANNOT DO: ${JSON.stringify(u.quote)} — ${u.reason}`);
if (superseded.length) {
  console.log(`\n  ${superseded.length} earlier instruction(s) replaced by this round (kept in the ledger, marked superseded):`);
  for (const d of superseded) console.log(`      was: ${d.kind}/${d.op} ${JSON.stringify(d.target)} — ${JSON.stringify(d.quote)}`);
}

// ---------------------------------------------------------------------------
// 4. Re-enter the pipeline at the lowest phase that can satisfy the request.
// ---------------------------------------------------------------------------
const PHASES = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"];

/** Mark a phase and everything after it as not-done, so --resume re-runs exactly that
 *  much and no more. inspectResume() also checks file freshness, so this cannot be used
 *  to skip work that genuinely went stale — only to force work that did not. */
function invalidateFrom(phase) {
  if (!fs.existsSync(manifestPath)) return [];
  const doc = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const from = PHASES.indexOf(phase);
  const hit = [];
  for (const p of PHASES.slice(from)) {
    if (!doc.phases?.[p]) continue;
    doc.phases[p] = { status: "pending", reason: `revision round ${round}: ${radius} radius` };
    hit.push(p);
  }
  doc.status = "running";
  fs.writeFileSync(manifestPath, JSON.stringify(doc, null, 2));
  return hit;
}

const invalidation = revisionInvalidation(incoming, radius);
let reenter;
if (radius === "timeline") {
  // The cheap path: patch the finished timeline and re-render it. The storyboard, the
  // photo assignment and — the point of all this — the approved COPY are all untouched.
  const abs = path.resolve(root, timelinePath);
  if (!fs.existsSync(abs)) die(`${timelinePath} does not exist yet — there is no preview to revise. Run the pipeline first.`);
  const timeline = JSON.parse(fs.readFileSync(abs, "utf8"));
  const patched = applyToTimeline(timeline, active(next));
  fs.writeFileSync(abs, JSON.stringify(timeline, null, 2) + "\n");
  console.log(`\n  patched ${timelinePath} directly (${patched.length} directive(s)) — no rebuild, no AI call, copy untouched`);
  reenter = invalidation.reenter;
} else {
  reenter = invalidation.reenter;
}

if (invalidation.requiresReapproval) {
  const approvalPath = project.abs(`${project.manifest.analysisDir}/previews/selection.json`);
  const invalidated = invalidateApproval(fs.existsSync(approvalPath) ? {
    read: () => fs.readFileSync(approvalPath, "utf8"),
    write: (value) => fs.writeFileSync(approvalPath, value),
  } : null, { round, radius });
  if (invalidated) console.log("  preview approval invalidated: generate and approve a new preview before final delivery");
}

const touched = invalidateFrom(reenter);
console.log(`  re-entering at: ${reenter}${touched.length ? ` (invalidated ${touched.join(", ")})` : ""}`);

const runArgs = ["scripts/runProject.mjs", "--project", projectArg, "--resume"];
if (!doRun) {
  console.log(`\n  Nothing has been rendered. To produce the new cut:\n    node ${runArgs.join(" ")}`);
  process.exit(0);
}
const r = spawnSync(process.execPath, runArgs, { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
