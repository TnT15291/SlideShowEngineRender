import { MAX_TRANSITION_SEC } from "./musicRetime.mjs";
import { chooseMusicEdit, sliceMusicAnalysis } from "./musicHighlight.mjs";
import { makeEnergy, MAX_SCENE } from "./pacing.mjs";
import { solveRecipeShotList } from "./recipeShotList.mjs";
import { scenePhotoCount } from "./scenePhotoCount.mjs";
import { MONTAGE_EFFECTS } from "./engineCapabilities.mjs";

function sceneDurationCeiling(sceneCount) {
  return sceneCount > 0
    ? (sceneCount - 1) * (MAX_SCENE - MAX_TRANSITION_SEC) + MAX_SCENE
    : 0;
}

export function planTemplateShotList({
  template,
  photos,
  heroPhoto,
  endingPhoto,
  library,
  direction,
  durationFor,
  sourceMusic,
  requestedMusicMode,
  initialMusic,
  initialMusicEdit,
}) {
  let music = initialMusic;
  let musicEdit = initialMusicEdit;
  const openingSource = template.scenes[0];
  const closingSource = template.scenes.find((scene) => scene.durationRole === "closing");
  const openingTakesHero = Boolean(openingSource)
    && openingSource.effect !== "video_background"
    && !MONTAGE_EFFECTS.has(openingSource.effect);
  const closingTakesEnding = Boolean(closingSource);

  const reservedPhotos = new Set([
    ...(openingTakesHero ? [heroPhoto.file] : []),
    ...(closingTakesEnding ? [endingPhoto.file] : []),
  ]);
  const editorialPhotoCount = new Set(photos.map((photo) =>
    photo.duplicateGroup ? `group:${photo.duplicateGroup}` : `file:${photo.file}`
  )).size;
  const bookendPoolCost =
    Math.max(
      0,
      (openingSource ? scenePhotoCount(openingSource, { library, direction }) : 0)
        - (openingTakesHero ? 1 : 0)
    )
    + Math.max(
      0,
      (closingSource ? scenePhotoCount(closingSource, { library, direction }) : 0)
        - (closingTakesEnding ? 1 : 0)
    );

  const composed = template.source?.origin === "composed";
  const solveShotList = () => solveRecipeShotList({
    recipe: template,
    photoCount: editorialPhotoCount,
    musicDuration: Number(music.duration) || 0,
    durationOf: (scene, at) => durationFor(scene.durationRole, at),
    photoDemandOf: (scene) => scenePhotoCount(scene, { library, direction }),
    bodyPhotoBudget: editorialPhotoCount - reservedPhotos.size - bookendPoolCost,
    energy: makeEnergy(music),
  });
  let shotList = composed
    ? {
        scenes: template.scenes.map((scene) => ({ ...scene })),
        fit: template.fit ?? { message: "composed", scale: 1 },
      }
    : solveShotList();

  const ceiling = () => sceneDurationCeiling(shotList.scenes.length);
  if (!composed && (musicEdit.mode === "loop" || musicEdit.mode === "playlist")) {
    const limit = ceiling();
    if (music.duration > limit) {
      console.log(
        `[applyStoryTemplate] ${musicEdit.mode} target ${music.duration}s exceeds what ${shotList.scenes.length} scenes can `
        + `sustain (≤${limit.toFixed(2)}s at this recipe's repeat caps) — using ${limit.toFixed(2)}s instead. `
        + `A richer recipe or a less aggressive cull would use more of the extension.`
      );
      music = { ...music, duration: +limit.toFixed(3) };
      musicEdit = { ...musicEdit, duration: +limit.toFixed(3) };
      shotList = solveShotList();
    }
  }

  if (!composed && !["loop", "playlist"].includes(musicEdit.mode)) {
    const limit = ceiling();
    if (music.duration > limit) {
      if (requestedMusicMode === "full_song") {
        throw new Error(
          `full-song was requested, but this recipe can sustain at most ${limit.toFixed(2)}s `
          + `with ${shotList.scenes.length} scenes. Choose highlight/auto or a richer recipe.`
        );
      }
      musicEdit = chooseMusicEdit(sourceMusic, photos.length, {
        mode: "highlight",
        targetDuration: limit,
        maxDuration: limit,
      });
      music = sliceMusicAnalysis(sourceMusic, musicEdit);
      console.log(
        `[applyStoryTemplate] recipe capacity trims the music window to ${musicEdit.duration}s `
        + `(${shotList.scenes.length} scenes can sustain at most ${limit.toFixed(2)}s).`
      );
      shotList = solveShotList();
    }
  }

  return { shotList, music, musicEdit, reservedPhotos };
}
