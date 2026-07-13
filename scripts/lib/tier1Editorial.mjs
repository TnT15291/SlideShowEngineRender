const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const round = (v) => +clamp(v).toFixed(3);

/** Deterministic editorial scores. Semantic analyzers may override these fields. */
export function deriveRoleScores(photo) {
  const q = photo.qualityNorm ?? 0.5;
  const exposure = 1 - clamp(Math.abs((photo.meanLuma ?? 128) - 128) / 110);
  const faces = photo.faces || (photo.faceBoxEstimate ? [{ box: photo.faceBoxEstimate, confidence: 0.35 }] : []);
  const faceCount = faces.length;
  const faceArea = faces.reduce((n, f) => n + (f.box?.width || 0) * (f.box?.height || 0), 0);
  const landscape = photo.orient === "landscape" ? 1 : 0;
  const emptySpace = clamp(1 - faceArea * 2.5);
  return {
    heroScore: round(0.5 * q + 0.25 * exposure + 0.2 * clamp(faceArea * 3) + 0.05 * landscape),
    openingScore: round(0.45 * q + 0.25 * exposure + 0.2 * landscape + 0.1 * emptySpace),
    emotionScore: round(0.5 * q + 0.35 * clamp(faceArea * 4) + 0.15 * clamp(faceCount / 2)),
    detailScore: round(0.65 * q + 0.25 * (faceCount === 0 ? 1 : 0) + 0.1 * exposure),
    groupScore: round(0.45 * q + 0.4 * clamp(faceCount / 4) + 0.15 * landscape),
    closingScore: round(0.4 * q + 0.25 * exposure + 0.2 * landscape + 0.15 * emptySpace),
    montageScore: round(0.65 * q + 0.2 * exposure + 0.15 * (faceCount <= 2 ? 1 : 0)),
  };
}

export const scoreForRole = (photo, role = "montage") => {
  const key = `${role}Score`;
  return photo[key] ?? photo.heroScore ?? photo.qualityNorm ?? 0;
};

export function editorialRole(scene, slot = {}) {
  if (slot.role) return slot.role;
  if (scene.arcBeat === "hook") return "opening";
  if (scene.arcBeat === "peak") return "hero";
  if (scene.arcBeat === "family") return "group";
  if (scene.arcBeat === "closing" || scene.durationRole === "closing") return "closing";
  if (/montage|film_roll|collage|memory/.test(`${scene.durationRole} ${scene.effect}`)) return "montage";
  return slot.slot === "hero" ? "hero" : "emotion";
}

export const DEFAULT_ARC = ["hook", "establish", "connection", "build", "family", "peak", "breathe", "closing"];

export function applyStoryArc(scenes, contract = {}) {
  const sequence = contract.sequence?.length ? contract.sequence : DEFAULT_ARC;
  return scenes.map((scene, i) => {
    if (scene.arcBeat) return scene;
    const position = scenes.length <= 1 ? 1 : i / (scenes.length - 1);
    const index = Math.min(sequence.length - 1, Math.round(position * (sequence.length - 1)));
    return { ...scene, arcBeat: sequence[index] };
  });
}

export function snapScenesToPhrases(slides, music, { maxShift = 1.25 } = {}) {
  const phrases = music.phrases || [];
  if (!phrases.length || slides.length < 2) return { slides, snapped: 0 };
  const copy = slides.map((s) => ({ ...s, transition: { ...s.transition } }));
  let cursor = 0, snapped = 0;
  for (let i = 0; i < copy.length - 1; i++) {
    const boundary = cursor + copy[i].duration - (copy[i].transition?.duration || 0);
    const nearest = phrases.reduce((a, p) => Math.abs(p.time - boundary) < Math.abs(a.time - boundary) ? p : a);
    const shift = nearest.time - boundary;
    if (Math.abs(shift) <= maxShift && copy[i].duration + shift >= 2) {
      copy[i].duration = +(copy[i].duration + shift).toFixed(2);
      snapped++;
    }
    cursor += copy[i].duration - (copy[i].transition?.duration || 0);
  }
  return { slides: copy, snapped };
}
