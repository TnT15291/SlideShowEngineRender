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
  extraMusicPaths = [],
  musicPath,
}) {
  const musicModeOrder = orders.find(
    (directive) => directive.kind === "music_mode" && directive.op === "set"
  );
  const configuredMusicMode = musicModeOrder?.target
    || musicModeArg
    || brief.musicMode
    || "auto";
  // HOW MANY TRACKS is a fact about the customer's upload; the mode only says how much of
  // ONE track to use. "playlist" is the only mode that can carry a second song, so extras
  // promote every other mode instead of being dropped.
  //
  // They WERE dropped, silently. A real job (song-nhi, classic-multisong-album-01) had two
  // songs uploaded and musicMode "full_song" — the intake dropdown offers auto/highlight/
  // full_song and has no playlist option — so this read "full_song", resolveMusicWindow ran
  // on track 1's analysis alone, and the timeline shipped ONE track. The plan phase had
  // already measured the pair at 442.7s and called it balanced against 104 photos; the
  // build then made 207s of film and let the engine's -stream_loop repeat song 1 over the
  // tail. Song 2 was never heard.
  const promotedFromMode = extraMusicPaths.length
    && configuredMusicMode !== "playlist"
    && configuredMusicMode !== "auto"
    ? configuredMusicMode
    : null;
  const requestedMusicMode = extraMusicPaths.length && configuredMusicMode !== "playlist"
    ? "playlist"
    : configuredMusicMode;
  if (promotedFromMode) {
    console.log(
      `[applyStoryTemplate] music mode "${promotedFromMode}" cannot carry ${extraMusicPaths.length + 1} tracks — `
      + `using playlist so every chosen song is heard. `
      + `(${promotedFromMode === "highlight" ? "the highlight window applies to a single track only" : "each song plays in full, joined with a crossfade"})`
    );
  }

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
    // sourceMusic is ALREADY the whole playlist when there are extras (the caller combines
    // the per-track analyses, crossfades subtracted), so its duration is the target — no
    // second, crossfade-blind sum of track lengths that disagreed with it by 2s per joint.
    const sourceDuration = Number(sourceMusic.duration) || 0;
    const extendedDuration = Math.max(sourceDuration, photoCount * NATURAL_SEC_PER_PHOTO);
    const usePlaylist = requestedMusicMode === "playlist" && extraMusicPaths.length > 0;
    if (requestedMusicMode === "playlist" && !extraMusicPaths.length) {
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
      ...(usePlaylist ? { trackCount: extraMusicPaths.length + 1 } : {}),
      // Recorded, not just logged: the receipt has to show that the customer's chosen mode
      // was overridden and why, or the override is the same silent decision as the drop.
      ...(promotedFromMode ? { promotedFrom: promotedFromMode } : {}),
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
    const source = musicEdit.trackCount
      ? `${musicEdit.trackCount} tracks joined are ${musicEdit.sourceDuration}s`
      : `source track is ${musicEdit.sourceDuration}s`;
    console.log(
      `[applyStoryTemplate] ${musicEdit.mode}: extending to ${musicEdit.duration}s `
      + `(${source}) so ${photoCount} photos are not rushed`
    );
  }

  return {
    requestedMusicMode,
    musicModeOrderId: musicModeOrder?.id,
    musicEdit,
    music,
  };
}
