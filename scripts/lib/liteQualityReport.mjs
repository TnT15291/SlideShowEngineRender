import { actionFor } from "./rules/policy.mjs";
import { readingLimit } from "./textBudget.mjs";

export const netDuration = (slides = []) => +slides.reduce((total, slide, index) =>
  total + Number(slide.duration || 0) - (index < slides.length - 1 ? Number(slide.transition?.duration || 0) : 0), 0).toFixed(3);

const filesOf = (slide) => [slide.image, ...(slide.images || []),
  ...(slide.layers || []).filter((layer) => layer.type === "image").map((layer) => layer.path)]
  .filter(Boolean);

const captionsOf = (slide) => [
  ...(slide.captions || []).map((caption) => ({ ...caption, source: "caption" })),
  ...(slide.layers || []).filter((layer) => layer.type === "text")
    .map((layer) => ({ ...layer, duration: layer.duration ?? slide.duration, role: layer.role || "body", source: "layer" })),
];

const groupKey = (file, byFile) => byFile.get(file)?.duplicateGroup || `file:${file}`;

export function evaluateLegacyVerdicts({ proxy = {}, tier = "lite" } = {}) {
  const problems = proxy.problems || [];
  // Freeze v1 semantics even after v2 promotes duplicate_photo to BLOCK.
  const actionable = problems.filter((problem) => tier === "lite" && problem.check === "duplicate_photo"
    ? false : actionFor(tier, problem.check) !== "warn");
  return {
    qa: actionable.length ? "review" : "clean",
    delivery: proxy.verdict === "ok" ? "pass" : "failed",
    mismatch: !actionable.length && proxy.verdict !== "ok",
  };
}

export function buildLiteQualityReport({ timeline, photos = [], proxy = {}, qaLoop = {}, musicDuration, tier = "lite" }) {
  const slides = timeline?.slides || [];
  const byFile = new Map(photos.map((photo) => [photo.file, photo]));
  const effectCounts = {};
  const layoutCounts = {};
  const useCounts = new Map();
  const withinSceneDuplicates = [];
  const adjacentDuplicates = [];
  const captions = [];
  let previous = new Set();

  slides.forEach((slide, index) => {
    effectCounts[slide.effect || "unknown"] = (effectCounts[slide.effect || "unknown"] || 0) + 1;
    const layout = slide.layout || (slide.effect === "layer_scene" ? "unknown" : null);
    if (layout) layoutCounts[layout] = (layoutCounts[layout] || 0) + 1;
    const files = filesOf(slide);
    files.forEach((file) => useCounts.set(file, (useCounts.get(file) || 0) + 1));
    const keys = files.map((file) => groupKey(file, byFile));
    const repeated = keys.filter((key, keyIndex) => keys.indexOf(key) !== keyIndex);
    if (repeated.length) withinSceneDuplicates.push({ sceneId: slide.id, keys: [...new Set(repeated)] });
    const current = new Set(keys);
    if (index > 0) {
      const collisions = [...current].filter((key) => previous.has(key));
      if (collisions.length) adjacentDuplicates.push({ sceneId: slide.id, previousSceneId: slides[index - 1].id, keys: collisions });
    }
    previous = current;

    for (const caption of captionsOf(slide)) {
      const text = String(caption.text || "");
      const duration = Number(caption.duration ?? slide.duration ?? 0);
      const readingUnits = timeline?.language === "en"
        ? text.trim().split(/\s+/).filter(Boolean).length
        : text.replace(/\s/g, "").length;
      captions.push({
        sceneId: slide.id,
        source: caption.source,
        role: caption.role || "caption",
        characters: text.length,
        duration,
        charactersPerSecond: duration > 0 ? +(readingUnits / duration).toFixed(2) : null,
        estimatedOverflow: text.length > 60 && !text.includes("\n"),
      });
    }
  });

  const duration = netDuration(slides);
  const target = Number(musicDuration ?? timeline?.metadata?.musicSync?.targetDuration ?? timeline?.metadata?.targetDuration ?? duration);
  const sortedUseCounts = [...useCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    version: 1,
    tier,
    scenes: slides.length,
    effectCounts,
    layoutCounts,
    photos: {
      selected: photos.length,
      references: sortedUseCounts.reduce((sum, [, count]) => sum + count, 0),
      usedUnique: sortedUseCounts.length,
      coverage: photos.length ? +(sortedUseCounts.length / photos.length).toFixed(4) : 0,
      useCounts: Object.fromEntries(sortedUseCounts),
      withinSceneDuplicates,
      adjacentDuplicates,
    },
    text: {
      captions,
      estimatedOverflow: captions.filter((caption) => caption.estimatedOverflow).length,
      readingRateViolations: captions.filter((caption) => caption.charactersPerSecond > readingLimit(timeline?.language)).length,
    },
    music: {
      targetDuration: target,
      netDuration: duration,
      drift: +(duration - target).toFixed(3),
    },
    verdicts: evaluateLegacyVerdicts({ proxy, tier }),
    qaLoopStatus: qaLoop.status || null,
  };
}
