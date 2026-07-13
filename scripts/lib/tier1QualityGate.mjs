const filesIn = (slide) => [slide.image, ...(slide.images || []),
  ...(slide.layers || []).filter((l) => l.type === "image").map((l) => l.path)].filter(Boolean);

export function evaluateTier1Quality(timeline, { safeMargin = 0.05, maxLayoutRun = 3, minClosingSeconds = 2.5,
  enforceClosing = Boolean(timeline.recipeDecisions?.recipeId) } = {}) {
  const errors = [], warnings = [], manualReview = [];
  const slides = timeline.slides || [];
  const used = new Set(slides.flatMap(filesIn));
  const mustUse = timeline.photoAssignment?.customerLocks?.mustUsePhotos || [];
  for (const file of mustUse.filter((f) => !used.has(f))) {
    errors.push({ id: "project", check: "must_use_coverage", flags: ["missing_must_use"], detail: `${file} is required but absent from the timeline` });
  }

  const width = timeline.project?.width || 1920, height = timeline.project?.height || 1080;
  const minX = width * safeMargin, minY = height * safeMargin;
  for (const slide of slides) for (const [index, layer] of (slide.layers || []).entries()) {
    if (layer.type !== "text") continue;
    if (layer.x < minX || layer.y < minY || layer.x + layer.width > width - minX || layer.y + layer.height > height - minY) {
      errors.push({ id: slide.id, check: "text_safe_area", flags: ["text_outside_safe_area"],
        detail: `text layer ${index} crosses the ${(safeMargin * 100).toFixed(0)}% title-safe margin` });
    }
  }

  const closing = slides.at(-1);
  const isClosing = closing && (closing.editorialBeat === "closing" || closing.durationRole === "closing" || /closing|ending/i.test(closing.id || ""));
  if (enforceClosing && !isClosing) errors.push({ id: closing?.id || "project", check: "closing_card", flags: ["missing_closing_card"], detail: "the final scene is not identified as a closing card" });
  else if (enforceClosing && closing.duration < minClosingSeconds) errors.push({ id: closing.id, check: "closing_card", flags: ["closing_too_short"], detail: `closing card is ${closing.duration}s; minimum is ${minClosingSeconds}s` });

  let run = 0, previous = null;
  for (const slide of slides) {
    const state = `${slide.effect || "none"}:${slide.layout || "none"}`;
    run = state === previous ? run + 1 : 1; previous = state;
    if (run === maxLayoutRun + 1 && !slide.allowSequence) warnings.push({ id: slide.id, check: "layout_repetition",
      flags: ["layout_run_exceeded"], detail: `${state} repeats for more than ${maxLayoutRun} consecutive scenes` });
  }

  const overlayKeys = (timeline.overlays || []).map((o) => o.variant || o.path).filter(Boolean);
  for (const key of new Set(overlayKeys)) if (overlayKeys.filter((x) => x === key).length > 1) {
    warnings.push({ id: "project", check: "overlay_repetition", flags: ["duplicate_overlay"], detail: `${key} is stacked more than once` });
  }
  for (const overlay of timeline.overlays || []) if (overlay.start == null && overlay.end == null) {
    manualReview.push({ id: "project", check: "overlay_repetition", flags: ["full_film_overlay"],
      detail: `${overlay.variant || overlay.path} runs for the full film; confirm the treatment does not feel repetitive` });
  }
  return { errors, warnings, manualReview, verdict: errors.length ? "error" : manualReview.length ? "manual-review" : warnings.length ? "warning" : "pass" };
}
