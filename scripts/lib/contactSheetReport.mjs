export function buildContactSheetReport({ timeline, proxy, clip, diversity, color, photos = [] }) {
  const photoByFile = new Map(photos.map((p) => [p.file, p]));
  const colorByFile = new Map((color?.decisions || []).map((d) => [d.file, d]));
  const flagsByScene = new Map();
  const add = (id, flag, severity = "warning") => {
    if (!flagsByScene.has(id)) flagsByScene.set(id, []);
    flagsByScene.get(id).push({ flag, severity });
  };
  for (const p of proxy?.problems || []) for (const f of p.flags || [p.check]) add(p.id, f, "error");
  for (const p of clip?.problems || []) for (const f of p.flags || []) add(p.id, f, "warning");
  for (const w of diversity?.warnings || []) for (const id of w.sceneIds) add(id, `repetition:${w.repeatedSignals.join("+")}`, "warning");
  for (const f of proxy?.checks?.tier1Gate?.warnings || []) add(f.id, f.flags?.[0] || f.check, "warning");
  for (const f of proxy?.checks?.tier1Gate?.manualReview || []) add(f.id, f.flags?.[0] || f.check, "manual-review");
  const mustUse = timeline.photoAssignment?.customerLocks?.mustUsePhotos || [];
  const used = new Set();
  let time = 0;
  const scenes = (timeline.slides || []).map((slide) => {
    const files = [slide.image, ...(slide.images || []), ...(slide.layers || []).filter((l) => l.type === "image").map((l) => l.path)].filter(Boolean);
    files.forEach((f) => used.add(f));
    for (const file of files) {
      const c = colorByFile.get(file);
      if (c && (c.confidence < 0.7 || Math.abs(c.brightness) >= 0.119)) add(slide.id, "color_review", "warning");
      const p = photoByFile.get(file);
      const layer = (slide.layers || []).find((l) => l.type === "image" && l.path === file);
      if ((p?.subjectCount ?? 0) >= 3 && (layer?.motionStrength ?? 0) > 0.03) add(slide.id, "group_motion_strong", "warning");
    }
    const start = time, mid = start + slide.duration / 2;
    time += slide.duration - (slide.transition?.duration || 0);
    const flags = flagsByScene.get(slide.id) || [];
    return { id: slide.id, editorialBeat: slide.editorialBeat || null, start: +start.toFixed(3), mid: +mid.toFixed(3), duration: slide.duration,
      effect: slide.effect, transition: slide.transition, motions: (slide.layers || []).filter((l) => l.type === "image" && l.motion).map((l) => l.motion),
      photos: files, copy: [...(slide.captions || []).map((c) => c.text), ...(slide.layers || []).filter((l) => l.type === "text").map((l) => l.text)].filter(Boolean),
      flags, status: flags.some((f) => f.severity === "error") ? "error"
        : flags.some((f) => f.severity === "manual-review") ? "manual-review" : flags.length ? "warning" : "pass" };
  });
  const missingMustUse = mustUse.filter((f) => !used.has(f));
  for (const f of missingMustUse) add("project", `missing_must_use:${f}`, "error");
  const projectFlags = flagsByScene.get("project") || [];
  return { version: 1, generatedAt: new Date().toISOString(), timeline: timeline.project?.name || null, scenes,
    projectFlags, coverage: { mustUse, missingMustUse, usedPhotos: used.size },
    summary: { pass: scenes.filter((s) => s.status === "pass").length, warning: scenes.filter((s) => s.status === "warning").length,
      manualReview: scenes.filter((s) => s.status === "manual-review").length, error: scenes.filter((s) => s.status === "error").length },
    verdict: projectFlags.some((f) => f.severity === "error") || scenes.some((s) => s.status === "error") ? "error"
      : projectFlags.some((f) => f.severity === "manual-review") || scenes.some((s) => s.status === "manual-review") ? "manual-review"
        : projectFlags.length || scenes.some((s) => s.status === "warning") ? "warning" : "pass" };
}
