import { resolveLiteStyleProfile } from "./liteStyleProfiles.mjs";

const compact = (value, max = 96) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > max * 0.6 ? boundary : max).trim()}…`;
};

/**
 * Prose keeps its sentences.
 *
 * A chapter's body used to be cut at a flat 96 characters, guessed here before
 * anything knew which layout would hold it, in what box, at what size. Wedding
 * story bodies run 90-140 characters, so almost every one was amputated
 * mid-clause: "Tuân và Tiên mang theo hoài bão vào…" lost Sài Gòn, the word the
 * whole sentence was travelling towards.
 *
 * Nothing needs guessing at this stage. `scripts/fitTextInTimeline.mjs` runs
 * over the built timeline, measures the real box with the real font, and
 * shrinks, wraps and only then trims. The bound here is a sanity limit on a
 * runaway generated paragraph, and it cuts between sentences, never inside one.
 */
const compactProse = (value, max = 240) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return sentenceEnd > max * 0.5 ? cut.slice(0, sentenceEnd + 1).trim() : compact(text, max);
};

export function adaptLiteStory({ story = {}, prompt = "", requestedStyle } = {}) {
  const { profile, provenance } = resolveLiteStyleProfile({ prompt, requested: requestedStyle });
  const beats = story.beats?.length ? story.beats : [{ heading: story.title || "Câu chuyện", body: "", preferredPhotos: [] }];
  return {
    version: 1,
    pipelineVersion: "lite-v2",
    styleProfile: profile.id,
    styleProvenance: provenance,
    generatedBy: story.generatedBy || "unknown",
    acts: beats.map((beat, index) => ({
      id: `beat_${String(index + 1).padStart(2, "0")}`,
      heading: compact(beat.heading || (index === 0 ? story.title : ""), 48),
      screenCopy: compactProse(beat.body),
      emotion: beat.emotion || "warm",
      sceneKind: beat.sceneKind || "single",
      photoHints: [...new Set((beat.preferredPhotos || []).filter(Boolean))].slice(0, 6),
      provenance: "story",
    })),
    closing: compact(story.closing, 72),
  };
}
