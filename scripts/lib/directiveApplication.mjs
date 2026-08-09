import fs from "node:fs";
import path from "node:path";
import { MONTAGE_MAX, MONTAGE_EFFECTS } from "./engineCapabilities.mjs";
import { MAX_LAYOUT_RUN } from "./rules/thresholds.mjs";

const root = process.cwd();
const timelineSchema = JSON.parse(fs.readFileSync(path.resolve(root, "schema/timeline.schema.json"), "utf8"));
const MAX_SLIDE_SEC = timelineSchema.$defs.slide.properties.duration?.maximum ?? 30;
const MONTAGE_SLOT = {
  film_roll_up: "film_roll", film_roll_left: "film_roll", film_roll_right: "film_roll",
  memory_wall: "memories", collage_grid: "grid", double_exposure: "pair",
};
const MONTAGE_COUNT = {
  film_roll_up: 8, film_roll_left: 8, film_roll_right: 8,
  memory_wall: 6, collage_grid: 6, double_exposure: 2,
};
export const isMontage = (effect) => effect in MONTAGE_SLOT;
export const UNSYNTHESISABLE = new Set(["layer_scene", "video_background"]);
const structural = (scene, index) => index === 0 || /closing|ending_card/.test(scene.id || "");
// ---------------------------------------------------------------------------
// Apply — deterministic overrides. The model is asked; this is what MAKES it so.
// ---------------------------------------------------------------------------

export const ROLE_TO_NOTE = {
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
 *   SINGLE-IMAGE target ("đoạn này dùng zoom chậm") — asks for a LOOK. It is honoured
 *   from the top of the scope and stops at MAX_LAYOUT_RUN scenes in a row, because a
 *   whole act flattened to one effect is not the film the customer described; it is
 *   what taking them literally produced. The seven-scene, forty-seven-second run of
 *   still frames that "mở đầu tĩnh" once shipped is the receipt.
 *
 *   This branch used to carry the note that a sweep "only ever LOWERS photo demand ...
 *   so it is safe". It is safe for the COMPILER — the assignment fills fewer slots and
 *   nothing throws. It was never safe for the FILM: three six-photo montages became
 *   three one-photo stills and fifteen of the couple's photographs left the film with
 *   no gate saying so. Freed photographs are therefore reallocated to montages that
 *   still have room, and whatever cannot be placed is reported with a reason.
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
/** Record what one order cost, on the order itself and in the running totals. The
 *  customer's sentence is quoted alongside the number so the receipt reads as a
 *  sentence and a consequence, not as an anonymous delta. */
function noteOrder(ledger, d, { scenes = [], freed = 0, reallocated = 0, lost = 0, capped = false, reasons = [] }) {
  ledger.byOrder[d.id] = { quote: d.quote, kind: d.kind, target: d.target, scenes, freed, reallocated, lost, capped, reasons };
  ledger.scenesRewritten += scenes.length;
  ledger.photoFreed += freed;
  ledger.photoReallocated += reallocated;
  ledger.photoLost += lost;
  if (capped) ledger.runsCapped += 1;
}

/** Hand `freed` photographs to the montages that still have room for them, skipping the
 *  scenes the directive just rewrote. Grows one declared photo at a time and re-measures
 *  with the caller's own demand function: photoDemandOf may apply the pacing direction's
 *  montage multiplier, so one declared photo does not necessarily cost one assigned
 *  photo. Same discipline as the surplus pass in recipeShotList.mjs — this is the same
 *  job (photos the fixed layouts cannot absorb, handed to the beats that exist for them),
 *  arriving from the directive layer instead of the solver.
 *
 *  Returns how many were actually placed. The remainder is a real loss and the caller
 *  reports it; it does not get rounded away. */
function reallocate(scenes, freed, demandOf, skip) {
  let placed = 0;
  for (const scene of scenes) {
    if (placed >= freed) break;
    if (skip.has(scene) || !MONTAGE_EFFECTS.has(scene.effect)) continue;
    const slot = scene.photoSlots?.[0];
    if (!slot || slot.fixedCount) continue;
    const room = (MONTAGE_MAX[scene.effect] ?? 0) - slot.count;
    for (let add = 0; add < room && placed < freed; add++) {
      const before = demandOf(scene);
      const cost = demandOf({ ...scene, photoSlots: [{ ...slot, count: slot.count + 1 }] }) - before;
      if (cost <= 0 || placed + cost > freed) break;
      slot.count += 1;
      placed += cost;
    }
  }
  return placed;
}

/** @param {object} [options.report] mutable; filled with what the orders cost the film.
 *   Kept as an out-parameter rather than a return value because the return type is a
 *   string[] of applied ids that applyStoryTemplate iterates and revisionDiff ignores. */
export function applyToStoryboard(doc, directives, { availablePhotos = Infinity, photoDemand, report } = {}) {
  const scenes = doc.scenes || [];
  const applied = [];
  const ledger = report || {};
  ledger.scenesRewritten ??= 0;
  ledger.photoFreed ??= 0;
  ledger.photoReallocated ??= 0;
  ledger.photoLost ??= 0;
  ledger.runsCapped ??= 0;
  ledger.byOrder ??= {};

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
      // Scenes ALREADY carrying the target, immediately before the scope, count toward
      // the run: three still frames in a row read as three still frames whoever wrote
      // them, and the customer sees the run, not its authorship.
      let run = 0;
      for (let i = candidates[0].i - 1; i >= 0 && scenes[i].effect === d.target; i--) run++;

      const rewritten = [];
      let freed = 0;
      let capped = false;
      for (const { scene, i } of candidates) {
        if (run >= MAX_LAYOUT_RUN) { capped = true; break; }
        run++;
        if (scene.effect === d.target) continue; // already what was asked for; costs nothing
        freed += Math.max(0, demandOf(scene) - 1);
        scenes[i] = { ...scene, effect: d.target, photoSlots: [{ slot: "hero", count: 1 }] };
        delete scenes[i].layout; // the new effect owns its own composition...
        delete scenes[i].text;   // ...so the layout's text slots no longer exist
        // A composed storyboard solved this number against the shape the scene HAD. A
        // six-image memory wall's nine seconds, kept by the one still frame that
        // replaced it, is nine seconds of nothing happening. Dropping it returns the
        // scene to the recipe's own duration table — the single model that already
        // exists — and retimeSlidesToMusic renormalises the film onto the track either
        // way, so the length does not move.
        delete scenes[i].durationSec;
        rewritten.push(scenes[i]);
      }
      if (!rewritten.length) {
        // Every scene in scope already looked like this, or the run cap left no room.
        if (capped) noteOrder(ledger, d, { capped: true, reasons: ["run_cap"] });
        continue;
      }

      const placed = reallocate(scenes, freed, demandOf, new Set(rewritten));
      const lost = freed - placed;
      const reasons = [
        ...(capped ? ["run_cap"] : []),
        ...(lost > 0 ? ["no_montage_capacity"] : []),
      ];
      noteOrder(ledger, d, {
        scenes: rewritten.map((s) => s.id),
        freed, reallocated: placed, lost, capped, reasons,
      });
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
    // "default"/"final" may currently be a cycled array (a few {type,duration}
    // variants) rather than one object — a customer asking for ONE transition
    // everywhere overrides that cycling, so this always collapses to a single entry,
    // keeping only the existing duration (from the first variant if it was an array).
    if (d.scope.global) {
      const prevDuration = (Array.isArray(ts.default) ? ts.default[0] : ts.default)?.duration ?? 0.8;
      ts.default = { duration: prevDuration, type: d.target };
      applied.push(d.id);
    } else if (d.scope.act === "ending") {
      const prevDuration = (Array.isArray(ts.final) ? ts.final[0] : ts.final)?.duration ?? 1.2;
      ts.final = { duration: prevDuration, type: d.target };
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
