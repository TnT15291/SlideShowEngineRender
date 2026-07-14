const TARGET_BEATS = ["hook", "connection", "build", "peak", "closing"];

function sceneRisk(slide) {
  const text = [...(slide.captions || []).map((c) => c.text),
    ...(slide.layers || []).filter((l) => l.type === "text").map((l) => l.text)].join(" ");
  const imageLayers = (slide.layers || []).filter((l) => l.type === "image");
  return text.length / 80 + Math.max(0, imageLayers.length - 1) +
    imageLayers.filter((l) => l.fit === "cover").length * 0.5 + ((slide.images || []).length > 2 ? 1 : 0);
}

/** Representative short cut; keeps real slides instead of fabricating a demo. */
export function makePreviewCut(timeline, { duration = 20, output } = {}) {
  const slides = timeline.slides || [];
  const picked = [];
  for (const beat of TARGET_BEATS) {
    const slide = slides.find((s) => s.editorialBeat === beat && !picked.includes(s));
    if (slide) picked.push(slide);
  }
  for (const slide of slides) {
    if (picked.length >= 5) break;
    if (!picked.includes(slide)) picked.push(slide);
  }
  // A template preview must show what makes that template worth choosing. Signature
  // scenes are authored differentiators (mask reveal, double exposure, film treatment),
  // not optional filler to lose behind five generic beat representatives.
  const signature = slides.find((s) => s.signature && !picked.includes(s));
  if (signature) {
    const replace = picked.findIndex((s) => !["hook", "closing"].includes(s.editorialBeat) && !s.signature);
    if (replace >= 0) picked[replace] = signature;
  }
  const riskiest = slides.reduce((best, slide) => sceneRisk(slide) > sceneRisk(best) ? slide : best, slides[0]);
  if (riskiest && sceneRisk(riskiest) > 0 && !picked.includes(riskiest)) {
    const replace = picked.findIndex((s) => !["hook", "closing"].includes(s.editorialBeat) && !s.signature);
    if (replace >= 0) picked[replace] = riskiest;
  }
  picked.sort((a, b) => slides.indexOf(a) - slides.indexOf(b));
  const each = Math.max(2.5, duration / Math.max(1, picked.length));
  const cutSlides = picked.map((slide, i) => ({ ...slide, duration: +each.toFixed(2),
    captions: (slide.captions || []).map((c) => ({ ...c, duration: +Math.max(0.1, Math.min(c.duration, each - c.start)).toFixed(2) })),
    transition: i === picked.length - 1 ? { type: "none", duration: 0 }
      : { ...slide.transition, duration: Math.min(0.7, slide.transition?.duration || 0.5) } }));
  return { ...timeline, project: { ...timeline.project, quality: "draft" }, output: { path: output || timeline.output.path }, slides: cutSlides,
    preview: { duration, sourceSceneIds: cutSlides.map((s) => s.id), beats: cutSlides.map((s) => s.editorialBeat || null),
      riskSceneIds: cutSlides.filter((s) => sceneRisk(s) > 0).map((s) => s.id) } };
}
