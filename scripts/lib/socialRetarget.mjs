const fullFrame = (l, w, h) => l.x <= 0 && l.y <= 0 && l.width >= w * 0.9 && l.height >= h * 0.9;
const photoRecord = (byFile, file) => byFile.get(file) || {};

export function retargetTimeline(timeline, { width, height, output, photos = [], label = "social" }) {
  const oldW = timeline.project.width, oldH = timeline.project.height;
  const byFile = new Map(photos.map((p) => [p.file, p]));
  const margin = Math.round(width * 0.06), textTop = Math.round(height * 0.72), photoBottom = textTop - margin;
  const slides = timeline.slides.map((slide) => {
    if (slide.effect !== "layer_scene") {
      if (slide.image) {
        const p = photoRecord(byFile, slide.image), safe = (p.subjectCount ?? 0) !== 1 || p.orient === "landscape";
        return { ...slide, effect: "layer_scene", captions: [], layers: [
          { type: "rect", x: 0, y: 0, width, height, color: "#111111", opacity: 1 },
          { type: "image", path: slide.image, x: margin, y: margin, width: width - margin * 2, height: photoBottom - margin,
            fit: safe ? "contain" : "cover", focusX: p.focusX ?? 0.5, focusY: p.focusY ?? 0.45,
            ...(slide.effect === "still" ? {} : { motion: "zoom_in", motionStrength: (p.subjectCount ?? 0) >= 3 ? 0.025 : 0.045, easing: slide.editorialBeat === "peak" ? "snap" : "gentle" }) },
          ...(slide.captions || []).map((c, i) => ({ type: "text", text: c.text, font: c.font, size: Math.min(c.size || 42, Math.round(width * 0.055)), color: c.color || "white",
            align: "center", x: margin, y: textTop + i * Math.round(height * 0.1), width: width - margin * 2, height: Math.round(height * 0.09), opacity: 1, start: c.start || 0, animation: c.animation || "fade" })),
        ] };
      }
      return { ...slide };
    }
    const layers = slide.layers || [];
    const decor = layers.filter((l) => l.type === "image" && /^assets\/frames\//.test(l.path));
    const images = layers.filter((l) => l.type === "image" && !decor.includes(l));
    const texts = layers.filter((l) => l.type === "text");
    const background = images.find((l) => fullFrame(l, oldW, oldH));
    const photosOnly = images.filter((l) => l !== background);
    const baseRect = layers.find((l) => l.type === "rect" && fullFrame(l, oldW, oldH));
    const out = [{ type: "rect", x: 0, y: 0, width, height, color: baseRect?.color || "#111111", opacity: 1 }];
    if (background) out.push({ ...background, x: 0, y: 0, width, height, fit: "cover" });
    const shown = photosOnly.length ? photosOnly : (background ? [] : images);
    const gap = Math.round(margin * 0.55), n = shown.length;
    shown.forEach((layer, i) => {
      const verticalStack = height / width > 1.5 || n > 2;
      const cellW = verticalStack ? width - margin * 2 : Math.floor((width - margin * 2 - gap * (n - 1)) / Math.max(1, n));
      const cellH = verticalStack ? Math.floor((photoBottom - margin - gap * (n - 1)) / Math.max(1, n)) : photoBottom - margin;
      const x = verticalStack ? margin : margin + i * (cellW + gap), y = verticalStack ? margin + i * (cellH + gap) : margin;
      const p = photoRecord(byFile, layer.path), safe = (p.subjectCount ?? 0) !== 1 || p.orient === "landscape";
      out.push({ ...layer, x, y, width: cellW, height: cellH, fit: safe ? "contain" : "cover", rotation: 0,
        motionStrength: (p.subjectCount ?? 0) >= 3 ? Math.min(layer.motionStrength || 0.025, 0.025) : layer.motionStrength });
    });
    if (texts.length && background) out.push({ type: "rect", x: 0, y: textTop - margin / 2, width, height: height - textTop + margin / 2, color: "#000000", opacity: 0.48 });
    const textH = Math.floor((height - textTop - margin) / Math.max(1, texts.length));
    texts.forEach((layer, i) => out.push({ ...layer, x: margin, y: textTop + i * textH, width: width - margin * 2, height: textH,
      size: Math.min(layer.size, Math.round(width * (layer.size > 70 ? 0.09 : 0.052))), align: "center" }));
    decor.forEach((layer) => out.push({ ...layer, x: 0, y: 0, width, height, fit: "stretch" }));
    return { ...slide, layers: out };
  });
  return { ...timeline, project: { ...timeline.project, name: `${timeline.project.name} — ${label}`, width, height, quality: "draft" }, output: { path: output }, slides,
    socialRetarget: { label, sourceAspect: `${oldW}:${oldH}`, target: { width, height }, strategy: "composition_aware" } };
}
