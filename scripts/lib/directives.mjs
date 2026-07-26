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
import { TAG_VOCAB } from "./vocab.mjs";
import { UNSYNTHESISABLE } from "./directiveApplication.mjs";

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
  "caption", "photo", "moment", "structure", "story",
]);

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
    case "moment":
      // A moment is matched by CONTENT TAG ("phải có cảnh trao nhẫn"), not a filename —
      // the customer cannot name a file they have not seen yet. It can only be required
      // or forbidden: "set" has no meaning for a tag the pipeline does not choose a
      // single photo for on the customer's behalf.
      if (op !== "forbid" && op !== "require") {
        return { ok: false, reason: `a moment can only be required or forbidden, not "${d.op}"`, quote };
      }
      if (!TAG_VOCAB.has(target)) return { ok: false, reason: `"${target}" is not a known photo-content tag`, quote };
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

export * from "./directiveLedger.mjs";
export * from "./directiveApplication.mjs";
export * from "./directiveAudit.mjs";
