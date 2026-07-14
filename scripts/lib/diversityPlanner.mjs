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

// "unknown" means the analysis never counted faces (photos analyzed before face
// detection landed). Two unknowns are not evidence of two similar frames — the
// people signal abstains rather than testifies, otherwise every pre-face-data album
// gets this signal as a repeat for free.
const peopleBlind = (s) => s.peoplePattern.split("+").includes("unknown");

/** Report repetitive visual states across scenes. Never flags similarity inside one scene. */
export function buildDiversityReport({ scenes, assignments, photos }) {
  const byFile = new Map(photos.map((p) => [p.file, p]));
  const states = scenes.map((scene) => {
    const files = [...assignments.entries()]
      .filter(([key]) => key.startsWith(`${scene.id}:`)).flatMap(([, values]) => values);
    return sceneState(scene, files, byFile);
  });
  const skipRun = (run) =>
    run.some((s) => s.allowSequence || ["editorial_sequence", "chapter_sequence"].includes(s.cohesionMode));
  const warnings = [];
  for (let i = 2; i < states.length; i++) {
    const run = states.slice(i - 2, i + 1);
    if (skipRun(run)) continue;
    const repeatedSignals = SIGNALS.filter((key) => {
      if (key === "peoplePattern" && run.some(peopleBlind)) return false;
      return run.every((s) => s[key] === run[0][key]);
    });
    // Orientation or people count alone is never a problem. Three independent
    // signals are required before a sequence is considered visually repetitive.
    if (repeatedSignals.length >= 3) warnings.push({
      sceneIds: run.map((s) => s.id), repeatedSignals, risk: +(repeatedSignals.length / SIGNALS.length).toFixed(2),
    });
  }
  // Adjacent PAIRS sharing a layout read as the same frame lingering, even when a
  // third scene breaks the run-of-three rule above. Lower risk on purpose: a pair
  // is "look at this", a run of three is "fix this". Pairs already inside a flagged
  // run are not reported twice.
  const flaggedPairs = new Set(
    warnings.flatMap((w) => w.sceneIds.slice(1).map((id, j) => `${w.sceneIds[j]}|${id}`))
  );
  for (let i = 1; i < states.length; i++) {
    const pair = [states[i - 1], states[i]];
    if (skipRun(pair) || flaggedPairs.has(`${pair[0].id}|${pair[1].id}`)) continue;
    if (["layout", "photoCount", "orientationPattern"].every((key) => pair[0][key] === pair[1][key])) {
      warnings.push({
        sceneIds: pair.map((s) => s.id),
        repeatedSignals: ["layout", "photoCount", "orientationPattern"],
        risk: 0.4,
        adjacentPair: true,
      });
    }
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
  // A null subjectCount is "never counted", not "matches every other uncounted photo".
  const samePeople = photo.subjectCount != null
    && peers.every((p) => p.subjectCount != null && bucketPeople(p.subjectCount) === bucketPeople(photo.subjectCount));
  return sameOrient && samePeople ? -1.5 : 0;
}
