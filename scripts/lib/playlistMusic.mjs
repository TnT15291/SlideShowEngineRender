import fs from "node:fs";
import path from "node:path";

export const PLAYLIST_CROSSFADE_SEC = 2;

export function combineMusicAnalyses(analyses, crossfade = PLAYLIST_CROSSFADE_SEC) {
  if (!Array.isArray(analyses) || !analyses.length) throw new Error("playlist needs at least one music analysis");
  let offset = 0;
  // Every time-stamped row an analysis carries. A key nobody shifted stayed on track 1's
  // clock while `duration` described the whole playlist — beats/buildWindows/calmWindows
  // all described the first song and claimed to describe the film.
  const TIME_KEYS = ["phrases", "downbeats", "beats", "sections", "buildWindows", "calmWindows"];
  const shifted = Object.fromEntries(TIME_KEYS.map((key) => [key, []]));
  // Only keys some track actually has are written back, so combining does not invent an
  // empty array where the analyzer emitted nothing.
  const present = new Set(TIME_KEYS.filter((key) => analyses.some((a) => Array.isArray(a?.[key]))));
  // The energy envelope is POSITIONAL — lib/pacing.mjs reads it as index * ENV_STEP — so it
  // concatenates instead of shifting. Keeping track 1's envelope under a playlist duration
  // silently restated the step as duration/length: on a 190s + 255s pair pacing.mjs warned
  // that spacing "looks like 1.165s, not 0.5s" and every calm/build verdict was read from
  // the wrong second of the song.
  const envelope = [];
  for (const [index, analysis] of analyses.entries()) {
    const duration = Number(analysis?.duration) || 0;
    if (duration <= 0) throw new Error("playlist track analysis needs a positive duration");
    for (const key of Object.keys(shifted)) {
      for (const item of analysis[key] || []) shifted[key].push({ ...item, time: undefined, start: undefined, end: undefined,
        ...(Number.isFinite(Number(item.time)) ? { time: +(offset + Number(item.time)).toFixed(3) } : {}),
        ...(Number.isFinite(Number(item.start)) ? { start: +(offset + Number(item.start)).toFixed(3) } : {}),
        ...(Number.isFinite(Number(item.end)) ? { end: +(offset + Number(item.end)).toFixed(3) } : {}) });
    }
    // The crossfade eats the tail of every track but the last, so drop that many samples of
    // it — the next track's samples occupy those slots on the playlist clock.
    const rows = analysis.envelope || [];
    const step = rows.length > 1 ? duration / rows.length : 0;
    const keep = index === analyses.length - 1 || !step
      ? rows.length
      : Math.max(1, Math.round((duration - crossfade) / step));
    envelope.push(...rows.slice(0, keep));
    offset += duration - crossfade;
  }
  return {
    ...analyses[0],
    duration: +(offset + crossfade).toFixed(3),
    ...Object.fromEntries([...present].map((key) => [key, shifted[key]])),
    ...(envelope.length ? { envelope } : {}),
    playlist: { tracks: analyses.length, crossfade },
  };
}

export function readPlaylistAnalyses({ root = process.cwd(), analysisDir, musicPaths, crossfade = PLAYLIST_CROSSFADE_SEC }) {
  const analyses = musicPaths.map((musicPath) => {
    const name = path.basename(musicPath).replace(/\.[^.]+$/, "");
    const analysisPath = path.resolve(root, `${analysisDir}/music/${name}.json`);
    if (!fs.existsSync(analysisPath)) throw new Error(`music analysis not found: ${analysisPath}`);
    return JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  });
  return combineMusicAnalyses(analyses, crossfade);
}

export function playlistFit({ duration, photoCount }) {
  const secondsPerPhoto = photoCount > 0 ? duration / photoCount : Infinity;
  const mismatch = secondsPerPhoto < 1.5 ? "too_many_photos"
    : secondsPerPhoto > 7.2 ? "too_much_music"
      : null;
  return {
    mismatch,
    secondsPerPhoto: Number.isFinite(secondsPerPhoto) ? +secondsPerPhoto.toFixed(2) : null,
    recommendedPhotos: Math.max(1, Math.round(duration / 4)),
  };
}
