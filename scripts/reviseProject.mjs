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
// --preview ANSWERS THE OTHER HALF. Printing the compiled directives looks like a
// preview but only restates the REQUEST; the CONSEQUENCE is elsewhere, and it bites:
// a single-image retarget deletes a scene's layout and text, and a montage splices its
// neighbours out of existence. Both are correct. Both were silent. --preview applies the
// round to a COPY, diffs it, names what would be lost, and writes NOTHING — no ledger,
// no timeline, no manifest. It is the only mode here that cannot change the film.
//
// --undo <round> TAKES A ROUND BACK. Not by applying an inverse — there is no such thing
// here, because the operations do not commute — but by withdrawing the round from the
// ledger and letting the film be re-derived from what is left. Two things make that
// honest rather than a coin flip: rebuilds are now repeatable (lib/textCache.mjs), and
// supersession is re-derived rather than trusted (recomputeSupersession), because
// appendRound only ever sets it and undo has to walk back through that one-way door.
//
// An undo never uses the timeline patch path, however narrow it looks: that patch is
// destructive in place (applyToTimeline DELETED the caption), so dropping the directive
// cannot bring the words back. Only the storyboard still has them. Floor: `build`.
//
// Exit: 0 applied (or previewed) · 4 needs --confirm-restory · 5 revision budget spent · 1 error.
//
// Usage:
//   node scripts/reviseProject.mjs --project <dir> --request "đoạn bạn bè dùng lật trang phim"
//   node scripts/reviseProject.mjs --project <dir> --request "..." --preview   # show, change nothing
//   node scripts/reviseProject.mjs --project <dir> --undo 2 [--preview]        # take round 2 back
//   node scripts/reviseProject.mjs --project <dir> --request-file reply.txt [--run]
//   ... [--confirm-restory] [--max-rounds 2] [--force] [--storyboard <path>]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { hasKey, callDeepSeekJSON } from "./lib/deepseek.mjs";
import { ruleHits, recallNet } from "./lib/briefRules.mjs";
import {
  validateDirective, loadLedger, saveLedger, appendRound, active, undoRound,
  blastRadius, widestRadius, applyToTimeline,
  EFFECTS, TRANSITIONS, CURVES, OVERLAYS, PACING, ACTS, ROLES, MUSIC_MODES,
} from "./lib/directives.mjs";
import { arg, loadProject, root } from "./lib/project.mjs";
import { revisionInvalidation, invalidateApproval } from "./lib/revisionInvalidation.mjs";
import { previewChange, formatDiff, photoDemandFrom } from "./lib/revisionDiff.mjs";
import { TAG_LIST } from "./lib/vocab.mjs";

const has = (flag) => process.argv.includes(flag);
const die = (msg) => { console.error(`[reviseProject] FAILED: ${msg}`); process.exit(1); };

const projectArg = arg("--project");
const project = loadProject(projectArg);
const requestFile = arg("--request-file", "");
const maxRounds = Number(arg("--max-rounds", "2"));
const confirmRestory = has("--confirm-restory");
const force = has("--force");
const doRun = has("--run");
const preview = has("--preview");
if (preview && doRun) die("--preview and --run are opposites: one shows, the other builds");

const request = (arg("--request", "") || (requestFile ? fs.readFileSync(path.resolve(root, requestFile), "utf8") : "")).trim();

// --undo <round>: take a round back. Not "apply the inverse" — these operations do not
// commute, so an inverse is a fiction. It withdraws the round from the ledger and lets
// the film be re-derived from what is left, which is only honest because a rebuild is
// now repeatable (lib/textCache.mjs). Before that, undo would have landed the customer
// somewhere new rather than somewhere they had been.
const undoArg = arg("--undo", "");
const undoTarget = undoArg ? Number(undoArg) : null;
if (undoArg && !Number.isInteger(undoTarget)) die(`--undo takes a round NUMBER, got ${JSON.stringify(undoArg)}`);
if (undoTarget !== null && request) die("--undo and --request are different operations — run them one at a time");
if (undoTarget === null && !request) {
  die(`nothing to do: pass --request "<what to change>", --request-file <file>, or --undo <round>`);
}
const undoing = undoTarget !== null;

const ledgerPath = project.rel("directives.json");
const timelinePath = project.rel(project.manifest.timeline);
const manifestPath = project.abs(`${project.manifest.analysisDir}/job-manifest.json`);

// Memoise this project's text calls (lib/textCache.mjs). runProject sets this for the
// nodes it spawns; this node is run BY HAND, so it must set its own or it gets none.
//
// Without it --preview is worthless. The compile runs at temperature 0.1, not 0: the
// same sentence really does land differently across runs (observed: "lật trang phim" ->
// smooth_left one call, squeeze_h the next). So the customer would approve one diff and
// apply another. A preview that does not bind the thing it previewed is just a rumour.
process.env.TEXT_CACHE_DIR = project.abs(project.manifest.analysisDir);

// ---------------------------------------------------------------------------
// 1. Compile the request. A revision is PURE IMPERATIVE — there is no story half.
//    Skipped entirely when undoing: an undo names a round, not a wish, so there is
//    nothing to compile and no reason to spend a model call finding that out.
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
    "  kind   : effect | transition | color | overlay | pacing | duration | music_mode | caption | photo | moment | structure | story",
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
    `  music_mode : ${[...MUSIC_MODES].join(" | ")}  (playlist/loop EXTEND a track too short for the photos — "nối thêm bài" -> playlist, "lặp lại bài" -> loop; highlight/full_song apply when the track is too LONG — the engine CAN do both, do not report either as impossible)`,
    `  moment     : one of ${TAG_LIST.join(", ")} — op is require or forbid ONLY (a moment is a CONTENT TAG, not a filename). "phải có cảnh trao nhẫn" -> require rings.`,
    "",
    "Use kind=structure or kind=story ONLY if they want the film RE-TOLD (different order, different narrative).",
    "Asking to change a look, an effect, a length or some words is NOT a story change.",
    "",
    'Return ONE JSON object: {"directives":[...], "unmapped":[{"quote":str,"reason":str}]}',
  ].join("\n");
}

let raw = { directives: [], unmapped: [] };
if (!undoing) {
  if (hasKey()) {
    raw = await callDeepSeekJSON({
      system: buildSystem(),
      user: `Their message:\n\n${request}\n\nCompile it now.`,
      temperature: 0.1, // extraction, not invention
      label: "reviseProject",
      // The same sentence must compile to the same round on --preview and on apply, so a
      // second run is a cache hit BY DESIGN. Say which one happened; announcing a call
      // that never went out is the small lie that makes the big ones believable.
      onCall: (real) => console.log(real ? "  DeepSeek revision-compile call..." : "  revision-compile: cached (same request as before — same answer, no call)"),
    });
  } else {
    raw = ruleHits(request); // no key: the rules ARE the compiler, and their misses are the honest report
  }
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

// The recall net. This node used to compute its rule hits and then discard them whenever
// a key was present — so the one place the customer does most of their directing was the
// one place with no net under the model. Caught live: "Dùng hiệu ứng lật trang phim"
// compiled to transition=smooth_left while the rule for lật trang -> film_roll_up sat
// unused. An instruction the model skips is an instruction that vanishes silently.
const missed = hasKey() && !undoing ? recallNet(request, incoming, "revision-rule") : [];
incoming.push(...missed);

if (!undoing && !incoming.length) {
  console.error(`[reviseProject] nothing in that message maps to something this engine can change.`);
  for (const u of unmapped) console.error(`  ✗ ${JSON.stringify(u.quote)} — ${u.reason}`);
  console.error(`\n  Nothing was changed. Ask them to be more specific, or say plainly that we cannot do it.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Build the new ledger, then gate it.
// ---------------------------------------------------------------------------
const ledger = loadLedger(ledgerPath);
const round = Math.max(0, ...ledger.directives.map((d) => d.round ?? 0)) + 1;

let next;
let affected;      // the directives whose presence changed — what the radius is measured on
let undone = [];
let restored = [];
if (undoing) {
  const result = undoRound(ledger, undoTarget, round);
  if (!result.undone.length) {
    // Undo is one-way by design, so "nothing to undo" has three quite different causes and
    // one unhelpful sentence. Say which one it is: a person staring at "nothing to undo"
    // for a round they can see in the file will go looking for a bug that is not there.
    const withdrew = ledger.directives.filter((d) => d.undoneBy === undoTarget);
    const already = ledger.directives.filter((d) => (d.round ?? 0) === undoTarget && d.undoneBy);
    const rounds = [...new Set(ledger.directives.map((d) => d.round ?? 0))].sort((a, b) => a - b);

    if (withdrew.length) {
      die(
        `round ${undoTarget} is itself an UNDO (it withdrew ${withdrew.length} instruction(s) from round ${withdrew[0].round}).\n` +
          `  There is no redo: an undo round holds marks, not orders, so there is nothing to take back.\n` +
          `  To reinstate what it withdrew, ask for it again — e.g. --request ${JSON.stringify(withdrew[0].quote)}`
      );
    }
    if (already.length) {
      die(`round ${undoTarget} was already undone (by round ${already[0].undoneBy}). Nothing to do.`);
    }
    die(
      `round ${undoTarget} has no instructions to undo.\n` +
        `  Rounds in this ledger: ${rounds.join(", ") || "(none)"}. Round 0 is the original prompt, not a revision.`
    );
  }
  next = result.ledger;
  undone = result.undone;
  restored = result.restored;
  // BOTH directions move the film: withdrawing "use polaroid" also reinstates whatever it
  // had replaced. Measuring the radius on the departures alone would under-rebuild.
  affected = [...undone, ...restored];
} else {
  next = appendRound(ledger, incoming, round);
  next.unmapped = [...(ledger.unmapped || []), ...unmapped.map((u) => ({ ...u, round }))];
  affected = incoming;
}

// UNDO NEVER TAKES THE TIMELINE PATH. A `timeline` radius means "patch the finished
// timeline in place and re-render" — and that patch is not reversible: applyToTimeline
// DELETED the caption, so dropping the directive cannot bring it back. The words only
// exist in the storyboard, so an undo must rebuild from there. Floor it at `build`.
const RADIUS_RANK = ["timeline", "build", "plan"];
const wider = (a, b) => (RADIUS_RANK.indexOf(a) >= RADIUS_RANK.indexOf(b) ? a : b);
const radius = undoing ? wider("build", widestRadius(affected)) : widestRadius(affected);

// A preview reports the gates rather than dying on them: its whole job is to say what
// WOULD happen, and "you have no rounds left" is part of that answer, not a reason to
// withhold it. It changes nothing either way, so there is nothing to protect it from.
//
// AN UNDO IS NEVER BUDGETED. The cap exists so a job ships, not to trap a customer inside
// a change they regret — "you have used all your revisions, so you must keep the montage
// that ate your vows" is not a deal anyone would sign. Applies still consume rounds, so
// the cap still binds the thing it was built to bind.
if (round > maxRounds && !force && !undoing) {
  const msg =
    `revision budget spent: this would be round ${round}, and the job allows ${maxRounds}.\n` +
    `  Rounds are capped for the same reason QA's repair loop is: an unbounded revise loop is how a job\n` +
    `  never ships. Pass --force to grant another round, or --max-rounds N to change the deal.`;
  if (!preview) {
    console.error(`[reviseProject] ${msg}`);
    process.exit(5);
  }
  console.log(`[reviseProject] NOTE — ${msg}`);
}

if (radius === "plan" && !confirmRestory && !preview) {
  const restory = affected.filter((d) => blastRadius(d) === "plan");
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
// 3. Record it. Append-only in both directions: the ledger is the only thing that
//    stops round 2 from silently undoing round 1 — and an undo is marked, not
//    deleted, so the receipt can still say "you asked for X, then took it back".
// ---------------------------------------------------------------------------
if (!preview) saveLedger(ledgerPath, next);

const where = (d) =>
  d.scope.act ? `act ${d.scope.act}` : d.scope.scene ? `scene ${d.scope.scene}` : d.scope.role ? `${d.scope.role} shots` : "the whole film";

if (undoing) {
  console.log(`\n[reviseProject] round ${round}: UNDO round ${undoTarget} — ${undone.length} instruction(s) withdrawn, blast radius = ${radius}`);
  for (const d of undone) {
    console.log(`  ↩ withdrawn: ${d.kind}/${d.op} ${JSON.stringify(d.target)} @ ${where(d)}`);
    console.log(`      they had said: ${JSON.stringify(d.quote)}`);
  }
  // The half a customer never expects. Taking back "use polaroid" does not return the
  // film to no-instruction — it returns whatever polaroid had replaced, which may be an
  // order from three rounds ago that everyone has forgotten.
  if (restored.length) {
    console.log(`\n  ${restored.length} earlier instruction(s) come BACK into force as a result:`);
    for (const d of restored) console.log(`      again: ${d.kind}/${d.op} ${JSON.stringify(d.target)} @ ${where(d)} — ${JSON.stringify(d.quote)}`);
  }
} else {
  const superseded = next.directives.filter((d) => d.supersededBy === round);
  console.log(`\n[reviseProject] round ${round}: ${incoming.length} change(s), blast radius = ${radius}`);
  for (const d of incoming) {
    console.log(`  • ${d.kind}/${d.op} ${JSON.stringify(d.target)} @ ${where(d)}  [${blastRadius(d)}]`);
    console.log(`      ${JSON.stringify(d.quote)}`);
  }
  for (const u of unmapped) console.log(`  ✗ CANNOT DO: ${JSON.stringify(u.quote)} — ${u.reason}`);
  if (missed.length) {
    console.log(`  (recall net caught ${missed.length} the model walked past: ${missed.map((d) => `${d.kind}/${d.target}`).join(", ")})`);
  }
  if (superseded.length) {
    console.log(`\n  ${superseded.length} earlier instruction(s) replaced by this round (kept in the ledger, marked superseded):`);
    for (const d of superseded) console.log(`      was: ${d.kind}/${d.op} ${JSON.stringify(d.target)} — ${JSON.stringify(d.quote)}`);
  }
}

// ---------------------------------------------------------------------------
// 3b. --preview: what this round would DO. Nothing has been written to reach here.
// ---------------------------------------------------------------------------
/** The storyboard a rebuild would start from: a composed one (premium) or the recipe
 *  (template). Resolved the same way runProject resolves it, and NEVER guessed — a
 *  preview of the wrong recipe is a confident lie, which is worse than "I don't know". */
function resolveStoryboard() {
  const explicit = arg("--storyboard", "");
  if (explicit) return explicit;
  const composed = project.rel(`${project.manifest.analysisDir}/storyboard.json`);
  if (fs.existsSync(path.resolve(root, composed))) return composed;
  if (project.manifest.recipe) return project.manifest.recipe;
  const choice = project.abs(`${project.manifest.analysisDir}/recipe_choice.json`);
  if (fs.existsSync(choice)) {
    try {
      const picked = JSON.parse(fs.readFileSync(choice, "utf8")).recipe;
      if (picked) return picked;
    } catch { /* a corrupt choice is a missing choice */ }
  }
  return "";
}

function readJson(p, fallback = null) {
  const abs = path.resolve(root, p);
  if (!fs.existsSync(abs)) return fallback;
  try { return JSON.parse(fs.readFileSync(abs, "utf8")); } catch { return fallback; }
}

if (preview) {
  console.log(`\n[reviseProject] PREVIEW — nothing was written. What this round would do:\n`);

  if (radius === "plan") {
    // Honest refusal. A plan-radius change re-runs the story nodes; the storyboard this
    // would diff against does not exist yet, and inventing a diff for a film that will be
    // re-pitched from scratch would be the exact "confident lie" this mode exists to stop.
    console.log(
      `  This is a RE-TELLING, not a revision — it cannot be previewed as a diff.\n` +
        `  It re-runs the story nodes and returns a different film: different acts, different\n` +
        `  words, possibly different photos. Apply it with --confirm-restory when they know that.`
    );
    process.exit(0);
  }

  // Honest refusal, the same shape as the plan-radius one above. A music_mode change's real
  // effect — the target duration solveRecipeShotList solves against, and therefore how many
  // scenes exist at all — lives entirely in the shot-list/retime math, which this diff has no
  // model of: it only compares PER-SCENE properties (layout, text, photo demand) on a fixed
  // scene list. A music_mode directive touches no scene's layout or text, so the diff always
  // comes back empty for it — "NOTHING WOULD CHANGE" would be exactly the confident lie this
  // mode exists to prevent, since applying it can lengthen or shorten the film outright.
  const musicModeChange = affected.find((d) => d.kind === "music_mode");
  if (musicModeChange) {
    console.log(
      `  This changes how the TRACK is used ("${musicModeChange.target}") — the film's target\n` +
        `  length and scene count are solved from that, not from any single scene's layout or\n` +
        `  text, so this cannot be shown as a scene-by-scene diff. Apply it and compare the\n` +
        `  rebuilt film's length/scene count to the current one.`
    );
    process.exit(0);
  }

  const sbPath = resolveStoryboard();
  const storyboard = sbPath ? readJson(sbPath) : null;
  if (!storyboard?.scenes) {
    console.log(
      `  Cannot preview: no storyboard to diff against` +
        (sbPath ? ` (${sbPath} is missing or has no scenes).` : `. Pass --storyboard <path>, or set "recipe" in project.json.`) +
        `\n  The directives above are what would be applied; their consequences are not knowable without it.`
    );
    process.exit(0);
  }

  const photosDoc = readJson(project.manifest.selectedPhotos || `${project.manifest.analysisDir}/photos.selected.json`)
    || readJson(project.rel(`${project.manifest.analysisDir}/photos.json`), { photos: [] });
  const library = readJson("layouts/library.json", { layouts: [] });

  const diff = previewChange({
    storyboard,
    before: active(ledger),
    after: active(next),
    availablePhotos: photosDoc?.photos?.length ?? Infinity,
    photoDemand: photoDemandFrom(library),
  });

  const lines = formatDiff(diff);
  if (!lines.length) {
    // Nothing changes. Both ways of arriving here are worth saying out loud, and they are
    // NOT the same sentence — telling someone their undo was ignored, when in fact a later
    // round already overrode it, sends them hunting for a bug that is not there.
    console.log(
      undoing
        ? `  NOTHING WOULD CHANGE in ${sbPath}.\n` +
            `  Round ${undoTarget} is already overridden by a later round, so withdrawing it changes\n` +
            `  nothing that is in force. To go back further, undo the round that replaced it.`
        : `  NOTHING WOULD CHANGE in ${sbPath}.\n` +
            `  Their words compiled into valid directives, but the film they describe is the film\n` +
            `  that already exists. Say that to them plainly — do not re-render and call it a revision.`
    );
    process.exit(0);
  }

  console.log(`  storyboard: ${sbPath}`);
  console.log(`  rebuild at: ${radius}\n`);
  for (const l of lines) console.log(l);

  if (diff.destructive) {
    console.log(
      `\n  ⚠ THIS DESTROYS WORK. Scenes and words listed above go away — the montage absorbs\n` +
        `    its neighbours, and a retargeted scene drops the layout and the text it carried.\n` +
        `    Show the customer this list before you apply it, not after they watch the cut.`
    );
  }
  console.log(`\n  To apply: re-run without --preview.`);
  process.exit(0);
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

// `affected`, not `incoming`: an undo's re-approval trigger lives in the directives that
// LEFT and the ones that came back, and `incoming` is empty on that path.
const invalidation = revisionInvalidation(affected, radius);
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
