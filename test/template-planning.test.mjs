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
