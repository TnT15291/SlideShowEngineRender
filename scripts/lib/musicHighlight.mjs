const round = (n) => +n.toFixed(3);

/** The line past which a full song stops being carriable: every photo would hold more
 *  than 7.2s of film (1.8x a natural 4s/photo cut). ONE predicate, because the premium
 *  gate that asks the customer about it and the cutter that acts on it must agree on
 *  when the question exists at all. */
export const FULL_SONG_MAX_SEC_PER_PHOTO = 7.2;
export const needsExcerpt = (music, photoCount) =>
  photoCount > 0 && (Number(music.duration) || 0) / photoCount >= FULL_SONG_MAX_SEC_PER_PHOTO;

/** Choose a contiguous, phrase-aligned music window when the full track would make
 * every photo carry more than FULL_SONG_MAX_SEC_PER_PHOTO seconds of film. */
export function chooseMusicEdit(music, photoCount, { mode = "auto", targetDuration } = {}) {
  const sourceDuration = Number(music.duration) || 0;
  if (!["auto", "highlight", "full_song"].includes(mode)) throw new Error(`unknown music mode "${mode}"`);
  if (mode === "full_song" || sourceDuration <= 0 || photoCount <= 0) {
    return { mode: "full_song", sourceDuration, start: 0, end: sourceDuration, duration: sourceDuration };
  }

  const wantsExcerpt = mode === "highlight" || (targetDuration > 0 && targetDuration < sourceDuration) || needsExcerpt(music, photoCount);
  if (!wantsExcerpt) return { mode: "full_song", sourceDuration, start: 0, end: sourceDuration, duration: sourceDuration };

  const desired = Math.min(105, Math.max(60, Number(targetDuration) || photoCount * 4));
  const phraseTimes = (music.phrases || []).map((p) => Number(p.time)).filter(Number.isFinite);
  const boundaries = [...new Set([0, ...phraseTimes, sourceDuration])].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < boundaries.length - 1; i++) {
    for (let j = i + 1; j < boundaries.length; j++) {
      const start = boundaries[i], end = boundaries[j], duration = end - start;
      if (duration < 60 || duration > 105) continue;
      const energy = meanEnergy(music, start, end);
      const early = meanEnergy(music, start, start + duration * 0.25);
      const late = meanEnergy(music, end - duration * 0.35, end);
      const beforeEnd = meanEnergy(music, Math.max(start, end - 8), Math.max(start, end - 2));
      const atEnd = meanEnergy(music, Math.max(start, end - 2), end);
      const cadenceDrop = beforeEnd - atEnd;
      const sectionBoundary = nearestSectionBoundary(music, end);
      const boundaryReward = sectionBoundary <= 0.5 ? 0.3 : sectionBoundary <= 1.5 ? 0.12 : 0;
      const score = -Math.abs(duration - desired) / desired + energy * 0.25 + (late - early) * 0.3
        + cadenceDrop * 0.9 + boundaryReward - atEnd * 0.2;
      if (!best || score > best.score) best = { start, end, duration, score, cadenceDrop, sectionBoundary };
    }
  }

  // Old analyses may have no phrases. Keep the edit contiguous and deterministic;
  // the analysis-version work can later make phrase data a hard requirement.
  const picked = best || { start: 0, end: Math.min(sourceDuration, desired), duration: Math.min(sourceDuration, desired) };
  return {
    mode: "highlight",
    sourceDuration,
    start: round(picked.start),
    end: round(picked.end),
    duration: round(picked.duration),
    reason: "photo_budget",
    fullSongRequiredPhotos: Math.ceil(sourceDuration / 7.2),
    selection: best ? { score: round(best.score), cadenceDrop: round(best.cadenceDrop),
      sectionBoundaryDrift: Number.isFinite(best.sectionBoundary) ? round(best.sectionBoundary) : null } : { fallback: true },
  };
}

/**
 * THE ONE PLACE THE MUSIC WINDOW IS DECIDED.
 *
 * It used to be decided twice. composeStoryboard solved the shot list against the FULL
 * track while applyStoryTemplate, reading the same job, quietly cut a highlight — and it
 * cuts one whenever a photo would have to carry more than 7.2 seconds, which is most
 * photo-poor weddings. On a real job (23 photos, a 203s song) the composer built 219
 * seconds of film for a 93-second excerpt: the two halves of premium disagreed about
 * which song they were making, and the build died on a misfit check that was right.
 *
 * Both sides now ask this function, with the same inputs, and get the same answer.
 */
export function resolveMusicWindow({ music, photoCount, orders = [], brief = {}, musicMode = "" }) {
  const durationOrder = orders.find((d) => d.kind === "duration" && d.op === "set");
  const modeOrder = orders.find((d) => d.kind === "music_mode" && d.op === "set");
  const mode = modeOrder?.target || musicMode || brief.musicMode || "auto";
  return chooseMusicEdit(music, photoCount, { mode, targetDuration: durationOrder?.target });
}

/** Present the selected excerpt as a zero-based track to pacing and phrase snapping. */
export function sliceMusicAnalysis(music, edit) {
  if (edit.mode === "full_song") return music;
  const start = edit.start, end = edit.end;
  const shiftRows = (rows = []) => rows
    .filter((p) => p.time >= start && p.time <= end)
    .map((p, index) => ({ ...p, index, time: round(p.time - start) }));
  const envelope = music.envelope || [];
  const step = envelope.length > 1 && music.duration ? music.duration / envelope.length : 0;
  const from = step ? Math.floor(start / step) : 0;
  const to = step ? Math.ceil(end / step) : envelope.length;
  return {
    ...music,
    duration: edit.duration,
    envelope: envelope.slice(from, to),
    beats: shiftRows(music.beats),
    downbeats: shiftRows(music.downbeats),
    phrases: shiftRows(music.phrases),
  };
}

function meanEnergy(music, start, end) {
  const env = music.envelope || [];
  if (!env.length || !music.duration || end <= start) return music.energy?.mean ?? 0.5;
  const from = Math.max(0, Math.floor(start / music.duration * env.length));
  const to = Math.min(env.length, Math.max(from + 1, Math.ceil(end / music.duration * env.length)));
  const values = env.slice(from, to);
  return values.reduce((n, v) => n + v, 0) / values.length;
}

function nearestSectionBoundary(music, time) {
  const boundaries = (music.sections || []).flatMap((s) => [Number(s.start), Number(s.end)]).filter(Number.isFinite);
  return boundaries.length ? Math.min(...boundaries.map((b) => Math.abs(b - time))) : Infinity;
}
