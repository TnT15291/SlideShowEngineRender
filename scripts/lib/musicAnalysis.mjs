export const MUSIC_ANALYSIS_VERSION = 2;

export function validateMusicAnalysis(music) {
  const missing = [];
  if (music?.analysisVersion !== MUSIC_ANALYSIS_VERSION) missing.push(`analysisVersion=${MUSIC_ANALYSIS_VERSION}`);
  if (!(Number(music?.duration) > 0)) missing.push("duration");
  if (!music?.beatGrid || !(Number(music.beatGrid.beatSeconds) > 0)) missing.push("beatGrid");
  if (!Array.isArray(music?.phrases) || music.phrases.length < 2) missing.push("phrases");
  return { ok: missing.length === 0, missing };
}
