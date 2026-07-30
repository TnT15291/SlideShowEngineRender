import {
  isMontage,
  ROLE_TO_NOTE,
  UNSYNTHESISABLE,
} from "./directiveApplication.mjs";
import { str } from "./strUtils.mjs";
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

    // A moment is a CONTENT fact ("does a rings photo appear"), so its evidence needs
    // the tag data applyToStoryboard's photo pool had — artifacts.photoTags, keyed by
    // filename. Without it this cannot be told from a photo that was never analysed.
    case "moment": {
      if (!scoped.length) return { honored: false, evidence: `${where} has no slides` };
      const tagsOf = artifacts.photoTags;
      if (!tagsOf) return { honored: null, evidence: "no photo_content.json to check against" };
      const hasTag = (slide) => photoFilesOf(slide).some((f) => (tagsOf[f] || []).includes(d.target));
      const carriers = scoped.filter(hasTag);
      if (d.op === "forbid") {
        return { honored: carriers.length === 0, evidence: `${carriers.length} slide(s) in ${where} still show a "${d.target}" photo` };
      }
      return {
        honored: carriers.length > 0,
        evidence: carriers.length ? `"${d.target}" appears in ${where}: ${carriers.map((s) => s.id).join(", ")}` : `no "${d.target}" photo appears in ${where}`,
      };
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
