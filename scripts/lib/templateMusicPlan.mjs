import {
  resolveMusicWindow,
  sliceMusicAnalysis,
} from "./musicHighlight.mjs";
import { NATURAL_SEC_PER_PHOTO } from "./fitPlan.mjs";

export function planTemplateMusic({
  orders,
  musicModeArg,
  brief,
  sourceMusic,
  photoCount,
  acceptMisfit,
  extraMusicPath,
  musicPath,
}) {
  const musicModeOrder = orders.find(
    (directive) => directive.kind === "music_mode" && directive.op === "set"
  );
  const requestedMusicMode = musicModeOrder?.target
    || musicModeArg
    || brief.musicMode
    || "auto";

  if (
    requestedMusicMode === "full_song"
    && sourceMusic.duration / photoCount >= 7.2
    && !acceptMisfit
  ) {
    throw new Error(
      `full-song was requested, but ${photoCount} photos cannot carry the ${sourceMusic.duration}s track naturally. `
      + `Add at least ${Math.ceil(sourceMusic.duration / 7.2) - photoCount} photo(s), choose highlight/auto, or pass --accept-misfit.`
    );
  }

  let musicEdit;
  if (requestedMusicMode === "playlist" || requestedMusicMode === "loop") {
    const sourceDuration = Number(sourceMusic.duration) || 0;
    const extendedDuration = Math.max(sourceDuration, photoCount * NATURAL_SEC_PER_PHOTO);
    const usePlaylist = requestedMusicMode === "playlist" && extraMusicPath;
    if (requestedMusicMode === "playlist" && !extraMusicPath) {
      console.log(
        `[applyStoryTemplate] playlist requested but no --extra-music given — looping "${musicPath}" instead.`
      );
    }
    musicEdit = {
      mode: usePlaylist ? "playlist" : "loop",
      sourceDuration,
      start: 0,
      end: sourceDuration,
      duration: +extendedDuration.toFixed(3),
      reason: "photo_budget_extend",
    };
  } else {
    musicEdit = resolveMusicWindow({
      music: sourceMusic,
      photoCount,
      orders,
      brief,
      musicMode: musicModeArg,
    });
  }

  const music = musicEdit.mode === "playlist" || musicEdit.mode === "loop"
    ? { ...sourceMusic, duration: musicEdit.duration }
    : sliceMusicAnalysis(sourceMusic, musicEdit);

  if (musicEdit.mode === "highlight") {
    console.log(
      `[applyStoryTemplate] highlight: ${musicEdit.start}s–${musicEdit.end}s (${musicEdit.duration}s) `
      + `because ${photoCount} photos cannot carry the ${musicEdit.sourceDuration}s full song naturally`
    );
  } else if (musicEdit.mode === "loop" || musicEdit.mode === "playlist") {
    console.log(
      `[applyStoryTemplate] ${musicEdit.mode}: extending to ${musicEdit.duration}s `
      + `(source track is ${musicEdit.sourceDuration}s) so ${photoCount} photos are not rushed`
    );
  }

  return {
    requestedMusicMode,
    musicModeOrderId: musicModeOrder?.id,
    musicEdit,
    music,
  };
}
