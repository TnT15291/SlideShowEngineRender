const bucketPeople = (n) => n == null ? "unknown" : n === 0 ? "detail" : n === 1 ? "solo" : n === 2 ? "pair" : "group";

export function sceneState(scene, files, byFile) {
  const photos = files.map((f) => byFile.get(f)).filter(Boolean);
  return {
    id: scene.id,
    layout: scene.layout || scene.effect,
    effect: scene.effect,
    photoCount: files.length,
    orientationPattern: photos.map((p) => p.orient || "unknown").join("+"),
    peoplePattern: photos.map((p) => bucketPeople(p.subjectCount)).join("+"),
    arcBeat: scene.arcBeat,
    cohesionMode: scene.cohesionMode || "auto",
    allowSequence: Boolean(scene.allowSequence),
  };
}

const SIGNALS = ["layout", "effect", "photoCount", "orientationPattern", "peoplePattern"];

/** Report repetitive visual states across scenes. Never flags similarity inside one scene. */
export function buildDiversityReport({ scenes, assignments, photos }) {
  const byFile = new Map(photos.map((p) => [p.file, p]));
  const states = scenes.map((scene) => {
    const files = [...assignments.entries()]
      .filter(([key]) => key.startsWith(`${scene.id}:`)).flatMap(([, values]) => values);
    return sceneState(scene, files, byFile);
  });
  const warnings = [];
  for (let i = 2; i < states.length; i++) {
    const run = states.slice(i - 2, i + 1);
    if (run.some((s) => s.allowSequence || ["editorial_sequence", "chapter_sequence"].includes(s.cohesionMode))) continue;
    const repeatedSignals = SIGNALS.filter((key) => run.every((s) => s[key] === run[0][key]));
    // Orientation or people count alone is never a problem. Three independent
    // signals are required before a sequence is considered visually repetitive.
    if (repeatedSignals.length >= 3) warnings.push({
      sceneIds: run.map((s) => s.id), repeatedSignals, risk: +(repeatedSignals.length / SIGNALS.length).toFixed(2),
    });
  }
  const coverage = {
    orientations: Object.fromEntries([...new Set(states.map((s) => s.orientationPattern))].map((v) => [v, states.filter((s) => s.orientationPattern === v).length])),
    people: Object.fromEntries([...new Set(states.map((s) => s.peoplePattern))].map((v) => [v, states.filter((s) => s.peoplePattern === v).length])),
    layouts: Object.fromEntries([...new Set(states.map((s) => s.layout))].map((v) => [v, states.filter((s) => s.layout === v).length])),
  };
  return { version: 1, policy: "multi_signal_scene_repetition", states, warnings, coverage, verdict: warnings.length ? "review" : "pass" };
}

/** Soft assignment penalty only when orientation AND people pattern repeat. */
export function neighborRepetitionPenalty(photo, request, assignments, requestByKey, photos) {
  const peers = [...assignments.entries()].filter(([key]) => {
    const other = requestByKey.get(key);
    return other && other.sceneId !== request.sceneId && Math.abs(other.order - request.order) <= 1;
  }).flatMap(([, files]) => files.map((f) => photos.find((p) => p.file === f)).filter(Boolean));
  if (!peers.length) return 0;
  const sameOrient = peers.every((p) => p.orient === photo.orient);
  const samePeople = peers.every((p) => bucketPeople(p.subjectCount) === bucketPeople(photo.subjectCount));
  return sameOrient && samePeople ? -1.5 : 0;
}
