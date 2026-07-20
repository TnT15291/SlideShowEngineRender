// The customer's instructions, compiled into constraints the pipeline must obey.
//
// A prompt is not just a mood to be felt — half of what a customer writes is
// IMPERATIVE ("dùng hiệu ứng lật trang phim ở đoạn bạn bè", "đừng có chữ trên ảnh
// cưới"). The pipeline used to read the story half and drop the imperative half on
// the floor, silently. This module is the other half: a typed, auditable ledger of
// what was asked, plus the code that enforces it and then PROVES it was enforced.
//
// Three rules give the layer its spine:
//
//   1. A DIRECTIVE MUST QUOTE THE CUSTOMER. `quote` is required and holds their own
//      words. A model cannot invent a request it can't attribute, and every line of
//      the compliance report is traceable to something a human actually typed.
//
//   2. WHAT CANNOT BE MAPPED IS NOT COERCED — it is reported. An instruction that
//      does not land on a real engine knob becomes `unmapped`, never a silent
//      default. The failure mode we are killing is not disobedience, it is disobeying
//      QUIETLY.
//
//   3. THE MODEL IS PERSUADED; THE CODE ENFORCES. Directives go into the system
//      prompt AND are re-applied as a deterministic override afterwards, because a
//      model that is asked nicely still drifts. Enforcement never depends on the
//      model having complied.
//
// AUDIT HONESTY. audit() returns honored ∈ {true, false, null}. `null` means "the
// timeline cannot prove this either way" and is NEVER reported as success. A
// compliance report that claims a win it cannot evidence is worse than no report.
//
// WHERE EACH KIND IS ENFORCED (the blast radius — see reviseProject.mjs):
//   timeline — caption text/forbid. Patch timeline.json, re-render. 0 AI calls.
//   build    — effect/transition/color/overlay/pacing/duration/photo. Rebuild the
//              storyboard + timeline from the same story. 0 AI calls, story intact.
//   plan     — structure/story. Re-runs the story nodes: A DIFFERENT FILM. This is
//              the only radius that may change what the customer already approved,
//              so it is the only one that requires explicit confirmation.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// --- engine vocabulary: loaded live from the schema that defines it ----------
const tl = JSON.parse(fs.readFileSync(path.resolve(root, "schema/timeline.schema.json"), "utf8"));
export const EFFECTS = new Set(tl.$defs.effect.enum);
export const TRANSITIONS = new Set(tl.$defs.transitionType.enum);
export const CURVES = new Set(tl.$defs.curvesPreset.enum);
/** The engine's hard cap on one slide. Read live, never restated: a montage that
 *  absorbs its neighbours inherits their SECONDS as well as their photos, and five
 *  8.7s beats make a 43s slide the engine will not accept. When that happened the
 *  timeline failed validation and renderWithRetry quietly dropped the whole director
 *  layer and shipped Lite — the customer's instruction did not just fail, it took the
 *  film down with it. A limit you enforce is worth more than a limit you remember. */
export const MAX_SLIDE_SEC = tl.$defs.slide.properties.duration?.maximum ?? 30;
export const OVERLAYS = new Set(["warm", "soft", "sunset", "none"]);
export const PACING = new Set(["slow", "medium", "fast", "dynamic"]);
// playlist/loop extend a track that is too SHORT for the album — the mirror of highlight
// (which trims a track too long for it). The engine already covers a video with whatever
// music it is given (buildAudioMuxArgs: -stream_loop -1, or acrossfade across a playlist);
// these two modes are the vocabulary that tells the build to reach for that instead of
// stretching every scene past comfort.
export const MUSIC_MODES = new Set(["auto", "highlight", "full_song", "playlist", "loop"]);
export const ACTS = ["opening", "love_story", "ceremony", "family_friends", "ending"];
export const ROLES = ["hero", "portrait", "group", "detail", "montage", "opening", "ending"];

export const KINDS = new Set([
  "effect", "transition", "color", "overlay", "pacing", "duration", "music_mode",
  "caption", "photo", "structure", "story",
]);

// Montage effects read a POOL of photos; single-image effects read one. The
// distinction decides what an act-scoped directive even means (see semantics below)
// and which photo slot applyStoryTemplate will look for.
const MONTAGE_SLOT = {
  film_roll_up: "film_roll", film_roll_left: "film_roll", film_roll_right: "film_roll",
  memory_wall: "memories", collage_grid: "grid", double_exposure: "pair",
};
const MONTAGE_COUNT = { film_roll_up: 8, film_roll_left: 8, film_roll_right: 8, memory_wall: 5, collage_grid: 6, double_exposure: 2 };
export const isMontage = (effect) => effect in MONTAGE_SLOT;

// Effects a storyboard scene cannot be retargeted TO, because they need data the
// scene does not carry and code must not invent: a layout id (layer_scene) or a
// video file (video_background).
const UNSYNTHESISABLE = new Set(["layer_scene", "video_background"]);

/** Effects whose scene is structural, not decorative: the title card and the closing
 *  card carry the couple's names and date. An act-wide effect sweep must not eat
 *  them — the customer asked to restyle their photos, not to lose their names. */
const structural = (scene, index) => index === 0 || /closing|ending_card/.test(scene.id || "");

// ---------------------------------------------------------------------------
// Directive shape
// ---------------------------------------------------------------------------
// { id, round, source, quote, kind, op, scope, target, strength, confidence }
//   op     — set | forbid | require
//   scope  — { global:true } | { act } | { scene } | { role }
//   target — an engine enum, a number (duration), a filename (photo), a string
//   strength — must | prefer.  must = a hard gate in QA. prefer = best effort.
// ---------------------------------------------------------------------------

const OPS = new Set(["set", "forbid", "require"]);
const STRENGTHS = new Set(["must", "prefer"]);

const str = (v, max = 240) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Clamp a raw (model-authored or hand-written) directive onto the engine's real
 *  vocabulary. Returns {ok:true, directive} or {ok:false, reason} — and a rejection
 *  is a REPORT, not a correction: see rule 2. */
export function validateDirective(raw, index = 0) {
  const d = raw && typeof raw === "object" ? raw : {};
  const quote = str(d.quote, 300);
  if (!quote) return { ok: false, reason: "no quote: a directive must cite the customer's own words" };

  const kind = str(d.kind, 20);
  if (!KINDS.has(kind)) return { ok: false, reason: `unknown kind "${kind}"`, quote };

  const op = OPS.has(d.op) ? d.op : "set";
  const strength = STRENGTHS.has(d.strength) ? d.strength : "must";

  // --- scope
  const s = d.scope && typeof d.scope === "object" ? d.scope : {};
  let scope;
  if (typeof s.act === "string" && ACTS.includes(s.act)) scope = { act: s.act };
  else if (typeof s.scene === "string" && s.scene) scope = { scene: s.scene };
  else if (typeof s.role === "string" && ROLES.includes(s.role)) scope = { role: s.role };
  else scope = { global: true };

  // --- target, per kind
  let target = d.target;
  switch (kind) {
    case "effect":
      if (!EFFECTS.has(target)) return { ok: false, reason: `"${target}" is not an engine effect`, quote };
      if (op === "set" && UNSYNTHESISABLE.has(target)) {
        return { ok: false, reason: `${target} needs a layout/video the customer did not supply; it cannot be applied as a directive`, quote };
      }
      break;
    case "transition":
      if (!TRANSITIONS.has(target)) return { ok: false, reason: `"${target}" is not an engine transition`, quote };
      break;
    case "color":
      if (target !== "none" && !CURVES.has(target)) return { ok: false, reason: `"${target}" is not an engine colour curve`, quote };
      break;
    case "overlay":
      if (!OVERLAYS.has(target)) return { ok: false, reason: `"${target}" is not an engine overlay`, quote };
      break;
    case "pacing":
      if (!PACING.has(target)) return { ok: false, reason: `"${target}" is not a pacing value`, quote };
      break;
    case "duration": {
      const n = Number(target);
      if (!Number.isFinite(n) || n < 10 || n > 900) return { ok: false, reason: `duration ${target}s is outside 10–900s`, quote };
      target = n;
      break;
    }
    case "music_mode":
      if (!MUSIC_MODES.has(target)) return { ok: false, reason: `"${target}" is not a music mode`, quote };
      scope = { global: true };
      break;
    case "caption":
      if (op === "set") {
        target = str(target, 200);
        if (!target) return { ok: false, reason: "caption set with no text", quote };
      } else target = null;
      break;
    case "photo":
      target = str(target, 300);
      if (!target) return { ok: false, reason: "photo directive with no filename", quote };
      break;
    case "structure":
    case "story":
      target = str(target, 300);
      if (!target) return { ok: false, reason: `${kind} directive with no content`, quote };
      break;
  }

  const confidence = Number.isFinite(d.confidence) ? Math.max(0, Math.min(1, d.confidence)) : 1;
  return {
    ok: true,
    directive: {
      id: str(d.id, 12) || `d${index + 1}`,
      round: Number.isFinite(d.round) ? d.round : 0,
      source: str(d.source, 20) || "prompt",
      quote, kind, op, scope, target, strength, confidence,
    },
  };
}

/** Which pipeline phase can satisfy this directive. Enforcing at the LOWEST phase
 *  that can is the whole safety property: a caption tweak must never re-roll the
 *  story and hand back a film the customer never approved. */
export function blastRadius(d) {
  if (d.kind === "structure" || d.kind === "story") return "plan";
  if (d.kind === "caption") return "timeline";
  return "build";
}
const RADIUS_RANK = { timeline: 0, build: 1, plan: 2 };
/** The widest radius in a set — i.e. the phase the pipeline must re-enter. */
export function widestRadius(directives) {
  let worst = "timeline";
  for (const d of directives) if (RADIUS_RANK[blastRadius(d)] > RADIUS_RANK[worst]) worst = blastRadius(d);
  return worst;
}

// ---------------------------------------------------------------------------
// Ledger I/O
// ---------------------------------------------------------------------------
export function loadLedger(file) {
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs)) return { version: 1, story: "", directives: [], unmapped: [] };
  const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  return {
    version: doc.version ?? 1,
    story: str(doc.story, 4000),
    directives: Array.isArray(doc.directives) ? doc.directives : [],
    unmapped: Array.isArray(doc.unmapped) ? doc.unmapped : [],
  };
}
export function saveLedger(file, ledger) {
  const abs = path.resolve(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(ledger, null, 2) + "\n");
}

/** Stamp ids that are unique ACROSS THE WHOLE LEDGER, not just within one round.
 *
 *  The rule extractor numbers from r1 every time it runs, so round 0 emitted r1,r2,r3 and
 *  round 1 emitted r1,r2 — the ledger then held two different orders under the id `r1`.
 *  Everything that dedupes or looks up by id (the applied-count, audit rows, the
 *  compliance report) silently merged two unrelated instructions into one. An id that is
 *  not unique is not an id. */
export const stampIds = (directives, round) =>
  directives.map((d, i) => ({ ...d, id: `r${round}.${i + 1}`, round }));

const conflictKey = (d) => `${d.kind}:${JSON.stringify(d.scope)}:${d.op}`;

/** Append a revision round. Directives ACCUMULATE — round 2 must not silently undo
 *  round 1. Where two rounds contradict (same kind + same scope), the LATER round
 *  wins, and the superseded one is marked rather than deleted, so the report can
 *  still say "you asked for X, then changed it to Y". */
export function appendRound(ledger, incoming, round) {
  const stamped = stampIds(incoming, round).map((d) => ({ ...d, source: "revision" }));
  const incomingKeys = new Set(stamped.map(conflictKey));
  const kept = ledger.directives.map((d) =>
    incomingKeys.has(conflictKey(d)) && !d.supersededBy ? { ...d, supersededBy: round } : d
  );
  return { ...ledger, directives: [...kept, ...stamped] };
}

/** Re-derive `supersededBy` across the whole ledger from what is still standing.
 *
 *  WHY THIS EXISTS: appendRound only ever SETS supersededBy, so it is a one-way door,
 *  and undo has to walk back through it. Restoring "whatever round N superseded" is not
 *  enough and is actively wrong:
 *
 *      r1 polaroid  --superseded by--> r2 circle_focus  --superseded by--> r3 film_roll
 *
 *  Undo r2 and a naive restore un-supersedes r1, leaving r1 AND r3 both in force on the
 *  same key — two contradictory orders, and whichever applies last wins by accident.
 *
 *  So supersession is DERIVED here rather than trusted: for each conflict key, a
 *  directive is superseded by the next round that also touched that key. Undone
 *  directives are invisible to that reckoning entirely. On a ledger with nothing undone this
 *  reproduces appendRound's answer exactly — it is the same rule, applied to survivors. */
export function recomputeSupersession(directives) {
  const groups = new Map();
  for (const d of directives) {
    if (d.undoneBy) continue; // withdrawn: it cannot supersede, and cannot be superseded
    const k = conflictKey(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }

  const replacedBy = new Map();
  for (const group of groups.values()) {
    const rounds = [...new Set(group.map((d) => d.round ?? 0))].sort((a, b) => a - b);
    for (const d of group) {
      const next = rounds.find((r) => r > (d.round ?? 0));
      if (next !== undefined) replacedBy.set(d.id, next);
    }
  }

  return directives.map((d) => {
    const by = replacedBy.get(d.id);
    if (by !== undefined) return { ...d, supersededBy: by };
    const { supersededBy, ...rest } = d; // nothing replaces it any more — back in force
    return rest;
  });
}

/** Withdraw a round. Undo is "stop asking for this, then re-derive" — never "apply the
 *  inverse", which cannot work when the operations do not commute.
 *
 *  The withdrawn directives are MARKED, not deleted, so the receipt can still say "you
 *  asked for X, then took it back".
 *
 *  UNDO IS ONE-WAY, deliberately. An undo round holds no directives of its own — it is a
 *  set of `undoneBy` marks — so there is nothing for a second undo to withdraw, and
 *  `--undo <an undo round>` finds nothing rather than performing a redo. That is the
 *  honest shape: to get a withdrawn order back, ask for it again, which costs one
 *  sentence and leaves a full audit trail. A redo verb would need marks on marks to stay
 *  auditable, and nobody has asked for the film to travel in that direction yet.
 *
 *  @returns {{ledger, undone, restored}} — `restored` is what comes back into force as a
 *  result, which the customer must be shown: undoing "use polaroid" silently reinstates
 *  whatever it had replaced, and a surprise is a surprise in both directions. */
export function undoRound(ledger, target, round) {
  const directives = ledger.directives || [];
  const undone = directives.filter((d) => (d.round ?? 0) === target && !d.undoneBy);
  if (!undone.length) return { ledger, undone: [], restored: [] };

  const wasActive = new Set(active(ledger).map((d) => d.id));
  const marked = directives.map((d) =>
    (d.round ?? 0) === target && !d.undoneBy ? { ...d, undoneBy: round } : d
  );
  const settled = recomputeSupersession(marked);
  const next = { ...ledger, directives: settled };

  return {
    ledger: next,
    undone,
    restored: active(next).filter((d) => !wasActive.has(d.id)),
  };
}

/** The directives actually in force: later rounds have replaced the superseded, and an
 *  undo has withdrawn the rest. */
export const active = (ledger) => (ledger.directives || []).filter((d) => !d.supersededBy && !d.undoneBy);

// ---------------------------------------------------------------------------
// Apply — deterministic overrides. The model is asked; this is what MAKES it so.
// ---------------------------------------------------------------------------

const ROLE_TO_NOTE = {
  hero: "heroEffect", portrait: "portraitEffect", group: "groupEffect",
  detail: "detailEffect", opening: "openingEffect", montage: "montageEffect",
};

/** Override director_notes (and the brief's pacing) from the directives. Returns the
 *  ids that landed, so the caller can record which of the customer's words actually
 *  moved a knob. */
export function applyToDirectorNotes(doc, directives) {
  const notes = doc.director_notes || (doc.director_notes = {});
  const brief = doc.creative_brief || (doc.creative_brief = {});
  const applied = [];

  for (const d of directives) {
    if (d.op !== "set") continue;
    if (d.kind === "effect") {
      // A role-scoped effect names a director-notes slot directly. A GLOBAL montage
      // effect is the montage slot — that is the only global effect note there is.
      if (d.scope.role && ROLE_TO_NOTE[d.scope.role]) {
        notes[ROLE_TO_NOTE[d.scope.role]] = d.target;
        applied.push(d.id);
      } else if (d.scope.global && isMontage(d.target)) {
        notes.montageEffect = d.target;
        applied.push(d.id);
      }
    } else if (d.kind === "transition") {
      if (d.scope.global) { notes.defaultTransition = d.target; applied.push(d.id); }
      else if (d.scope.act === "ending" || d.scope.role === "ending") { notes.endingTransition = d.target; applied.push(d.id); }
    } else if (d.kind === "color") {
      notes.colorCurves = d.target === "none" ? null : d.target;
      applied.push(d.id);
    } else if (d.kind === "overlay") {
      notes.overlayVariant = d.target === "none" ? null : d.target;
      applied.push(d.id);
    } else if (d.kind === "pacing" && d.scope.global) {
      brief.pacing = d.target;
      applied.push(d.id);
    }
  }
  return applied;
}

/** Override the five-act plan: act-scoped pacing and priority effect. */
export function applyToStoryPlan(doc, directives) {
  const segments = doc.segments || [];
  const applied = [];
  for (const d of directives) {
    if (d.op !== "set" || !d.scope.act) continue;
    const seg = segments.find((s) => s.segment === d.scope.act);
    if (!seg) continue;
    if (d.kind === "pacing") { seg.pacing = d.target; applied.push(d.id); }
    else if (d.kind === "effect") { seg.priorityEffect = d.target; applied.push(d.id); }
  }
  return applied;
}

/** SEMANTICS of an effect directive, and why they differ by target:
 *
 *   SINGLE-IMAGE target ("đoạn này dùng zoom chậm") — asks for a LOOK, so it sweeps
 *   every retargetable scene in scope. Honour = "all of them". A sweep only ever
 *   LOWERS photo demand (a 3-photo layout becomes a 1-photo shot), so it is safe.
 *
 *   MONTAGE target ("đoạn bạn bè dùng lật trang phim") — asks the act to CONTAIN a
 *   montage. This one is dangerous, and the danger is not obvious:
 *
 *     composeStoryboard SOLVES the shot list against the photo budget — total photo
 *     demand across all scenes is exactly what the pool can fill. Retargeting a
 *     1-photo scene into an 8-photo film roll silently adds 7 slots to that sum, and
 *     the photo assignment then fails to fill 8 slots and the whole build dies. (It
 *     did. That is how this comment came to exist.)
 *
 *   So a montage does not INFLATE a scene — it ABSORBS its neighbours in the same act,
 *   inheriting their photos and their seconds. Net demand: unchanged. Net length:
 *   unchanged. Which is also what a montage IS, editorially: several beats compressed
 *   into one run of images.
 *
 * Structural scenes (title card, closing card) are exempt from all of this: they carry
 * the couple's names and date. An effect request must not cost them their names.
 */
export function applyToStoryboard(doc, directives, { availablePhotos = Infinity, photoDemand } = {}) {
  const scenes = doc.scenes || [];
  const applied = [];

  // How many photos a scene consumes. The caller knows (it has the layout library);
  // without it we can only see the slots a scene declares explicitly.
  const demandOf = photoDemand || ((scene) => (scene.photoSlots || []).reduce((n, s) => n + (s.count || 1), 0) || 1);

  const inScope = (scene, i, d) =>
    d.scope.global ? !structural(scene, i)
      : d.scope.act ? scene.act === d.scope.act && !structural(scene, i)
        : d.scope.scene ? scene.id === d.scope.scene   // an explicitly named scene is never "exempt"
          : false;

  for (const d of directives) {
    if (d.kind !== "effect" || d.op !== "set") continue;

    // video_background carries a video asset and no photo; sweeping it into a photo
    // effect would throw away a designed flourish to satisfy a look. Left alone —
    // and audit() exempts it on exactly the same rule, so the report stays honest.
    const candidates = scenes
      .map((scene, i) => ({ scene, i }))
      .filter(({ scene, i }) => inScope(scene, i, d) && scene.effect !== "video_background");
    if (!candidates.length) continue;

    if (!isMontage(d.target)) {
      for (const { scene, i } of candidates) {
        scenes[i] = { ...scene, effect: d.target, photoSlots: [{ slot: "hero", count: 1 }] };
        delete scenes[i].layout; // the new effect owns its own composition...
        delete scenes[i].text;   // ...so the layout's text slots no longer exist
      }
      applied.push(d.id);
      continue;
    }

    // --- montage: absorb neighbours, never inflate ---------------------------
    // Walk the act's scenes in order, taking a continuous run. The run is bounded by
    // BOTH caps: the photos a montage can show, and the seconds a slide may last. A
    // run that respects only the photo cap produces a 43-second slide the engine
    // rejects — and the rejection does not fail loudly, it drops the director layer.
    const cap = Math.min(MONTAGE_COUNT[d.target], availablePhotos);
    const run = [];
    let photos = 0;
    let seconds = 0;
    for (const c of candidates) {
      if (run.length && c.i !== run[run.length - 1].i + 1) break; // one continuous beat, not a mosaic
      const secs = c.scene.durationSec || 0;
      if (run.length && (photos + demandOf(c.scene) > cap || seconds + secs > MAX_SLIDE_SEC)) break;
      run.push(c);
      photos += demandOf(c.scene);
      seconds += secs;
    }

    // A montage of one photo is not a montage. Rather than fake it — or steal a photo
    // the budget has already promised elsewhere — we do not apply it, and let audit()
    // tell the customer plainly that this act had no room for what they asked for.
    if (photos < 2) continue;

    const head = run[0];
    const montage = {
      ...head.scene,
      effect: d.target,
      photoSlots: [{ slot: MONTAGE_SLOT[d.target], count: Math.min(cap, photos) }],
      ...(seconds > 0 ? { durationSec: +seconds.toFixed(2) } : {}),
    };
    delete montage.layout;
    delete montage.text;

    scenes.splice(head.i, run.length, montage); // the absorbed scenes are gone, their budget is not
    applied.push(d.id);
  }

  // Transitions live in the recipe's transitionStrategy, not per-scene.
  for (const d of directives) {
    if (d.kind !== "transition" || d.op !== "set") continue;
    const rules = doc.timelineRules || (doc.timelineRules = {});
    const ts = rules.transitionStrategy || (rules.transitionStrategy = {});
    if (d.scope.global) {
      ts.default = { ...(ts.default || { duration: 0.8 }), type: d.target };
      applied.push(d.id);
    } else if (d.scope.act === "ending") {
      ts.final = { ...(ts.final || { duration: 1.2 }), type: d.target };
      applied.push(d.id);
    }
  }

  // NB duration is NOT scaled here. It is a timeline fact — the audit measures it on the
  // finished slides, overlaps and all — so it is settled in applyToTimeline(), once, where
  // the thing that sets it and the thing that checks it are looking at the same numbers.

  return [...new Set(applied)];
}

/** Everything a FINISHED timeline can settle on its own: captions, transitions, colour,
 *  overlays, a global look, and the film's length.
 *
 *  Three jobs, and it has to be one function to do all three:
 *
 *   1. THE CHEAP PATH for a text revision — patch and re-render, no rebuild, no AI. In
 *      premium a rebuild re-runs the copywriter, which would rewrite the very words the
 *      customer just approved, so this is a correctness requirement, not a shortcut.
 *   2. THE LAST LINE OF ENFORCEMENT — if a rebuild failed to honour "đừng có chữ trên
 *      ảnh cưới", the film does not reach the customer with the words still on it.
 *   3. THE ONLY PLACE THE LITE TIER CAN OBEY AT ALL. Lite builds a flat timeline with a
 *      different generator, so without this it would ignore every order — and then the
 *      compliance gate would fail the run for it. A cheap tier is a smaller film, not a
 *      tier that gets to ignore the customer.
 *
 *  EVERY OPERATION HERE IS IDEMPOTENT — each one sets an absolute target rather than
 *  nudging a value — so callers may run it after their own pass without double-applying.
 *  That is what lets applyStoryTemplate and the Lite generator share it safely. */
export function applyToTimeline(doc, directives) {
  const slides = doc.slides || [];
  const applied = [];

  // --- colour + overlays: whole-film facts, so they live on the timeline ------
  for (const d of directives) {
    if (d.op !== "set") continue;
    if (d.kind === "color") {
      const color = doc.color || (doc.color = {});
      if (d.target === "none") delete color.curves;
      else color.curves = d.target;
      applied.push(d.id);
    } else if (d.kind === "overlay") {
      doc.overlays = d.target === "none"
        ? []
        : [{ variant: d.target, position: "fullscreen", opacity: 0.5, blend: "screen" }];
      applied.push(d.id);
    }
  }

  const hit = (slide, d) =>
    d.scope.global ? true
      : d.scope.act ? slide.act === d.scope.act
        : d.scope.scene ? slide.id === d.scope.scene
          : false;

  // Transitions are ALSO settled here, not only in the storyboard's transitionStrategy.
  // That strategy names two transitions — the default and the film's last — so an
  // act-scoped order landed on exactly one slide of a five-slide act, and audit() (which
  // reads the act) called it broken. It was right to. Enforcing the scope the customer
  // actually wrote, on the artifact the audit actually reads, is what keeps the thing
  // that PROMISES and the thing that CHECKS from drifting apart.
  for (const d of directives) {
    if (d.kind !== "transition" || d.op !== "set") continue;
    // The final slide's transition is how the film ENDS; a global "use crossfade" is
    // about the cuts between scenes and has no business rewriting the ending.
    const scoped = slides.filter((s, i) => hit(s, d) && !(d.scope.global && i === slides.length - 1));
    let touched = false;
    for (const slide of scoped) {
      if (!slide.transition || slide.transition.type === d.target) continue;
      slide.transition = {
        type: d.target,
        duration: d.target === "none" ? 0 : slide.transition.duration,
      };
      touched = true;
    }
    if (touched || scoped.every((s) => s.transition?.type === d.target)) applied.push(d.id);
  }

  for (const d of directives) {
    if (d.kind !== "caption") continue;
    let touched = false;
    for (const slide of slides) {
      if (!hit(slide, d)) continue;
      if (d.op === "forbid") {
        if (slide.captions?.length) { slide.captions = []; touched = true; }
        const before = slide.layers?.length ?? 0;
        if (before) {
          slide.layers = slide.layers.filter((l) => l.type !== "text");
          if (slide.layers.length !== before) touched = true;
        }
      } else if (d.op === "set" && d.scope.scene) {
        // Only a scene-scoped `set` is meaningful: writing one line onto every slide
        // of an act would be vandalism, not a revision.
        slide.captions = [{ text: d.target, role: "caption" }];
        touched = true;
      }
    }
    if (touched) applied.push(d.id);
  }

  // --- a whole-film LOOK -----------------------------------------------------
  // Only single-image effects, and only onto slides that can carry one. A layer_scene
  // is a composed card and a video_background has no photograph; sweeping them would
  // cost the customer their title card to satisfy a look. audit() exempts exactly the
  // same slides, so the report says "3/3 photo slides (2 text cards exempt)" and means it.
  for (const d of directives) {
    if (d.kind !== "effect" || d.op !== "set" || !d.scope.global || isMontage(d.target)) continue;
    let touched = false;
    for (const slide of slides) {
      if (UNSYNTHESISABLE.has(slide.effect) || slide.effect === d.target) continue;
      slide.effect = d.target;
      touched = true;
    }
    if (touched) applied.push(d.id);
  }

  // --- the film's length -----------------------------------------------------
  // Measured the way audit() measures it — slide durations MINUS the transition overlaps
  // — because a length the setter and the checker compute differently is a directive that
  // can never be satisfied. Scaling to an absolute target keeps this idempotent.
  const duration = directives.find((d) => d.kind === "duration" && d.op === "set");
  if (duration && slides.length) {
    const overlap = slides.reduce((n, s) => n + (s.transition?.duration || 0), 0);
    const span = slides.reduce((n, s) => n + (s.duration || 0), 0);
    if (span > 0) {
      const k = (duration.target + overlap) / span;
      for (const slide of slides) {
        // The engine caps a slide at MAX_SLIDE_SEC, and a transition must be shorter than
        // the slide it leaves. Stretching past either produces a timeline that fails
        // validation — and a failed premium timeline is silently downgraded to Lite.
        slide.duration = +Math.min(MAX_SLIDE_SEC, (slide.duration || 0) * k).toFixed(3);
        if (slide.transition && slide.transition.duration >= slide.duration) {
          slide.transition = { ...slide.transition, duration: +Math.max(0, slide.duration - 0.1).toFixed(3) };
        }
      }
      applied.push(duration.id);
    }
  }

  return [...new Set(applied)];
}

// ---------------------------------------------------------------------------
// Audit — the timeline is the evidence. This is what makes it a director and not
// a suggestion box: we do not ask whether we TRIED to obey, we check the artifact.
// ---------------------------------------------------------------------------

const photoFilesOf = (slide) => [
  slide.image,
  ...(slide.images || []),
  ...((slide.layers || []).filter((l) => l.type === "image").map((l) => l.path)),
].filter(Boolean);

const hasText = (slide) =>
  Boolean(slide.captions?.length) || (slide.layers || []).some((l) => l.type === "text" && str(l.text));

/** Slides a given directive is allowed to judge. */
function slidesInScope(slides, d) {
  if (d.scope.scene) return slides.filter((s) => s.id === d.scope.scene);
  if (d.scope.act) return slides.filter((s) => s.act === d.scope.act);
  if (d.scope.global) return slides;
  return []; // role scope is not judged against the timeline — see auditOne
}

function auditOne(d, timeline, artifacts) {
  const slides = timeline.slides || [];
  const scoped = slidesInScope(slides, d);
  const where = d.scope.scene ? `scene ${d.scope.scene}`
    : d.scope.act ? `act ${d.scope.act}`
      : d.scope.role ? `${d.scope.role} shots`
        : "the whole film";

  switch (d.kind) {
    case "effect": {
      // A role-scoped effect is a director-notes fact; its evidence lives there.
      if (d.scope.role) {
        const note = ROLE_TO_NOTE[d.scope.role];
        const notes = artifacts.directorNotes?.director_notes;
        if (!notes) return { honored: null, evidence: "no director_notes.json to check against" };
        const ok = notes[note] === d.target;
        return { honored: ok, evidence: `director_notes.${note} = ${notes[note]}${ok ? "" : ` (asked for ${d.target})`}` };
      }
      if (!scoped.length) return { honored: false, evidence: `${where} has no slides` };
      const carriers = scoped.filter((s) => s.effect === d.target);
      if (d.op === "forbid") {
        return { honored: carriers.length === 0, evidence: `${carriers.length} slide(s) in ${where} still use ${d.target}` };
      }
      if (isMontage(d.target)) {
        return {
          honored: carriers.length > 0,
          evidence: carriers.length
            ? `${d.target} in ${where}: ${carriers.map((s) => s.id).join(", ")}`
            : `no ${d.target} montage in ${where}`,
        };
      }
      // single-image sweep: every slide that CAN carry the look must carry it
      const eligible = scoped.filter((s) => !UNSYNTHESISABLE.has(s.effect) || s.effect === d.target);
      const exempt = scoped.length - eligible.length;
      if (!eligible.length) {
        return { honored: false, evidence: `${where} has no slide that can carry ${d.target} (all ${scoped.length} are text cards / video backgrounds)` };
      }
      const got = eligible.filter((s) => s.effect === d.target).length;
      return {
        honored: got === eligible.length,
        evidence: `${d.target} on ${got}/${eligible.length} photo slides in ${where}${exempt ? ` (${exempt} text card(s) exempt)` : ""}`,
      };
    }

    case "music_mode": {
      const got = timeline.recipeDecisions?.musicEdit?.mode;
      const honored = d.target === "auto" ? ["highlight", "full_song", "playlist", "loop"].includes(got) : got === d.target;
      return { honored, evidence: `music edit mode is ${got || "not recorded"} (asked for ${d.target})` };
    }

    case "transition": {
      if (!scoped.length) return { honored: false, evidence: `${where} has no slides` };
      // The last slide's transition is the ending, not the default — judge it apart.
      const judged = d.scope.global ? scoped.slice(0, -1) : scoped;
      if (!judged.length) return { honored: null, evidence: "nothing to judge" };
      const got = judged.filter((s) => s.transition?.type === d.target).length;
      if (d.op === "forbid") return { honored: got === 0, evidence: `${got} slide(s) in ${where} still transition with ${d.target}` };
      return { honored: got === judged.length, evidence: `${d.target} on ${got}/${judged.length} transitions in ${where}` };
    }

    case "color": {
      const curves = timeline.color?.curves ?? null;
      const want = d.target === "none" ? null : d.target;
      return { honored: curves === want, evidence: `timeline.color.curves = ${curves ?? "none"}` };
    }

    case "overlay": {
      const list = timeline.overlays || [];
      if (d.target === "none") return { honored: list.length === 0, evidence: `${list.length} overlay(s) on the film` };
      const ok = list.some((o) => o.variant === d.target);
      return { honored: ok, evidence: ok ? `overlay ${d.target} is on the film` : `overlays are: ${list.map((o) => o.variant).join(", ") || "none"}` };
    }

    case "duration": {
      const total = slides.reduce((n, s) => n + (s.duration || 0) - (s.transition?.duration || 0), 0);
      const drift = Math.abs(total - d.target) / d.target;
      return {
        honored: drift <= 0.1, // ±10%: the track and the phrase-snap own the last few seconds
        evidence: `film is ${total.toFixed(1)}s (asked for ~${d.target}s, ${(drift * 100).toFixed(0)}% off)`,
      };
    }

    case "caption": {
      if (!scoped.length) return { honored: false, evidence: `${where} has no slides` };
      const withText = scoped.filter(hasText);
      if (d.op === "forbid") {
        return { honored: withText.length === 0, evidence: `${withText.length}/${scoped.length} slide(s) in ${where} still carry text` };
      }
      if (d.op === "require") {
        return { honored: withText.length > 0, evidence: `${withText.length}/${scoped.length} slide(s) in ${where} carry text` };
      }
      const ok = scoped.some((s) => (s.captions || []).some((c) => str(c.text) === d.target));
      return { honored: ok, evidence: ok ? `"${d.target}" is on ${where}` : `"${d.target}" is not on ${where}` };
    }

    case "photo": {
      const used = new Set(slides.flatMap(photoFilesOf));
      const present = used.has(d.target);
      if (d.op === "forbid") return { honored: !present, evidence: present ? `${d.target} is still in the film` : `${d.target} is not used` };
      return { honored: present, evidence: present ? `${d.target} is in the film` : `${d.target} never made the cut` };
    }

    // Pacing is a feeling, not a number the timeline can be cross-examined about;
    // asserting it from average slide length would need a seconds→"slow" table
    // nobody can defend. Its evidence is the artifact that recorded the decision.
    case "pacing": {
      const brief = artifacts.directorNotes?.creative_brief;
      if (d.scope.act) {
        const seg = (artifacts.storyPlan?.segments || []).find((s) => s.segment === d.scope.act);
        if (!seg) return { honored: null, evidence: "no story_plan.json to check against" };
        return { honored: seg.pacing === d.target, evidence: `story_plan[${d.scope.act}].pacing = ${seg.pacing}` };
      }
      if (!brief) return { honored: null, evidence: "no director_notes.json to check against" };
      return { honored: brief.pacing === d.target, evidence: `creative_brief.pacing = ${brief.pacing}` };
    }

    // Structure and story reshape the film itself; there is no single field that
    // proves "the story is now about X". Say so rather than invent a green tick.
    case "structure":
    case "story":
      return { honored: null, evidence: "re-planned the film; not mechanically verifiable — needs a human eye" };

    default:
      return { honored: null, evidence: `no audit rule for kind ${d.kind}` };
  }
}

/** Cross-examine the finished timeline against every directive still in force.
 *  `artifacts` may carry directorNotes / storyPlan for the kinds whose evidence is
 *  a decision record rather than a slide. */
export function audit(directives, timeline, artifacts = {}) {
  const results = directives.map((d) => {
    const { honored, evidence } = auditOne(d, timeline, artifacts);
    return { id: d.id, round: d.round, kind: d.kind, op: d.op, scope: d.scope, target: d.target, strength: d.strength, quote: d.quote, honored, evidence };
  });
  const broken = results.filter((r) => r.strength === "must" && r.honored === false);
  return {
    total: results.length,
    honored: results.filter((r) => r.honored === true).length,
    broken: broken.length,
    unverifiable: results.filter((r) => r.honored === null).length,
    pass: broken.length === 0,
    results,
  };
}

/** The receipt the customer reads. An AI director that cannot do something says so. */
export function formatReport(report, unmapped = []) {
  const mark = (h) => (h === true ? "✓" : h === false ? "✗" : "?");
  const lines = [
    `${report.total} yêu cầu · ${report.honored} đã thực hiện · ${report.broken} không làm được` +
      (report.unverifiable ? ` · ${report.unverifiable} không kiểm chứng được` : ""),
  ];
  for (const r of report.results) {
    lines.push(`  ${mark(r.honored)} ${JSON.stringify(r.quote)}${r.strength === "prefer" ? " (ưu tiên)" : ""}`);
    lines.push(`      → ${r.evidence}`);
  }
  for (const u of unmapped) {
    lines.push(`  ✗ ${JSON.stringify(u.quote)}`);
    lines.push(`      → ${u.reason}`);
  }
  return lines.join("\n");
}
