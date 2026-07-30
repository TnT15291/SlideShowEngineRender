import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { planTemplateMusic } from "../scripts/lib/templateMusicPlan.mjs";
import { planTemplateShotList } from "../scripts/lib/templateShotList.mjs";

test("template music planning rejects a full song the photo set cannot carry", () => {
  assert.throws(
    () => planTemplateMusic({
      orders: [],
      musicModeArg: "full_song",
      brief: {},
      sourceMusic: { duration: 180 },
      photoCount: 20,
      acceptMisfit: false,
      extraMusicPath: "",
      musicPath: "music/song.mp3",
    }),
    /20 photos cannot carry the 180s track naturally/
  );
});

test("template music planning degrades a playlist without a second track to loop", () => {
  const originalLog = console.log;
  console.log = () => {};
  try {
    const plan = planTemplateMusic({
      orders: [],
      musicModeArg: "playlist",
      brief: {},
      sourceMusic: { duration: 60 },
      photoCount: 20,
      acceptMisfit: false,
      extraMusicPath: "",
      musicPath: "music/song.mp3",
    });
    assert.equal(plan.requestedMusicMode, "playlist");
    assert.equal(plan.musicEdit.mode, "loop");
    assert.equal(plan.music.duration, 80);
  } finally {
    console.log = originalLog;
  }
});

// THE REGRESSION: a real job (song-nhi on classic-multisong-album-01) uploaded two songs
// with musicMode "full_song" — the only modes the intake dropdown offers are auto/highlight/
// full_song, none of which means "playlist" — and shipped with ONE track in the timeline.
// The mode describes how much of a single song to use; it cannot decide how many songs
// there are, so extras have to win.
const quiet = (run) => {
  const originalLog = console.log;
  console.log = () => {};
  try { return run(); } finally { console.log = originalLog; }
};

for (const mode of ["full_song", "highlight", "loop"]) {
  test(`template music planning promotes "${mode}" to playlist rather than dropping extra tracks`, () => {
    const plan = quiet(() => planTemplateMusic({
      orders: [],
      musicModeArg: mode,
      brief: {},
      // What the caller hands in for a playlist: ONE combined analysis spanning every track.
      sourceMusic: { duration: 442.72, playlist: { tracks: 2, crossfade: 2 } },
      photoCount: 104,
      acceptMisfit: false,
      extraMusicPaths: ["music/two.mp3"],
      musicPath: "music/one.mp3",
    }));
    assert.equal(plan.requestedMusicMode, "playlist");
    assert.equal(plan.musicEdit.mode, "playlist");
    assert.equal(plan.musicEdit.trackCount, 2);
    assert.equal(plan.musicEdit.promotedFrom, mode, "the overridden mode is on the receipt, not only in a log");
    // Timed to the combined playlist, not to track 1 and not to a second crossfade-blind sum.
    assert.equal(plan.musicEdit.duration, 442.72);
    assert.equal(plan.music.duration, 442.72);
  });
}

test("template music planning leaves an explicit playlist and plain auto unpromoted", () => {
  for (const mode of ["auto", "playlist"]) {
    const plan = quiet(() => planTemplateMusic({
      orders: [],
      musicModeArg: mode,
      brief: {},
      sourceMusic: { duration: 300 },
      photoCount: 60,
      acceptMisfit: false,
      extraMusicPaths: ["music/two.mp3"],
      musicPath: "music/one.mp3",
    }));
    assert.equal(plan.musicEdit.mode, "playlist");
    assert.equal(plan.musicEdit.promotedFrom, undefined, `${mode} already allows a playlist — nothing was overridden`);
  }
});

test("template music planning still honours highlight when there is only one track", () => {
  const plan = quiet(() => planTemplateMusic({
    orders: [],
    musicModeArg: "highlight",
    brief: {},
    sourceMusic: { duration: 180, phrases: [{ time: 0 }, { time: 60 }], sections: [] },
    photoCount: 12,
    acceptMisfit: false,
    extraMusicPaths: [],
    musicPath: "music/one.mp3",
  }));
  assert.equal(plan.requestedMusicMode, "highlight");
  assert.equal(plan.musicEdit.mode, "highlight");
});

test("template shot-list planning preserves an already composed storyboard", () => {
  const scenes = [
    { id: "opening", effect: "still", durationSec: 7, photoSlots: [{ slot: "hero" }] },
    {
      id: "closing",
      effect: "still",
      durationRole: "closing",
      durationSec: 6,
      photoSlots: [{ slot: "hero" }],
    },
  ];
  const photos = [{ file: "a.jpg" }, { file: "b.jpg" }];
  const plan = planTemplateShotList({
    template: {
      id: "composed-test",
      source: { origin: "composed" },
      scenes,
      fit: { message: "already solved", scale: 1 },
    },
    photos,
    heroPhoto: photos[0],
    endingPhoto: photos[1],
    library: { layouts: [] },
    direction: null,
    durationFor: () => {
      throw new Error("a composed storyboard must not be solved again");
    },
    sourceMusic: { duration: 20 },
    requestedMusicMode: "auto",
    initialMusic: { duration: 20 },
    initialMusicEdit: { mode: "full_song", duration: 20 },
  });

  assert.deepEqual(plan.shotList.scenes, scenes);
  assert.notEqual(plan.shotList.scenes[0], scenes[0], "the returned scenes remain safe to mutate");
});

test("template shot-list planning clamps loop duration to recipe capacity", () => {
  const template = JSON.parse(fs.readFileSync("story-templates/warm-film-01.json", "utf8"));
  const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
  const photos = Array.from({ length: 40 }, (_, index) => ({
    file: `photo-${index}.jpg`,
  }));
  const originalLog = console.log;
  console.log = () => {};
  try {
    const plan = planTemplateShotList({
      template,
      photos,
      heroPhoto: photos[0],
      endingPhoto: photos.at(-1),
      library,
      direction: null,
      durationFor: (scene) => scene.durationRole === "closing" ? 6 : 5,
      sourceMusic: { duration: 60 },
      requestedMusicMode: "loop",
      initialMusic: { duration: 100_000, envelope: [] },
      initialMusicEdit: { mode: "loop", duration: 100_000, sourceDuration: 60 },
    });

    assert.ok(plan.music.duration < 100_000);
    assert.equal(plan.music.duration, plan.musicEdit.duration);
  } finally {
    console.log = originalLog;
  }
});
