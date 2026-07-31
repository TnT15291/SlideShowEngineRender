import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildPhotoAssignmentRequests } from "../scripts/lib/templatePhotoRequests.mjs";
import { resolveTemplate, visualSignature } from "../scripts/lib/lookResolver.mjs";
import { inspectCaptionLanguage } from "../scripts/lib/captionLanguage.mjs";
import { scenePhotoCount } from "../scripts/lib/scenePhotoCount.mjs";

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, "layouts", "library.json"), "utf8"));
const recipes = fs.readdirSync(path.join(root, "story-templates"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(root, "story-templates", file), "utf8")));

test("default template overlays leave the photographs in control", () => {
  for (const recipe of recipes) {
    const overlays = recipe.defaults?.overlays || [];
    const totalOpacity = overlays.reduce((sum, overlay) => sum + (overlay.opacity ?? 1), 0);
    assert.ok(
      totalOpacity <= 0.3,
      `${recipe.id} stacks ${totalOpacity.toFixed(2)} opacity across its full-film overlays`,
    );
  }
});
test("authored special transitions stay inside their own grammar limits", () => {
  for (const recipe of recipes) {
    const limits = recipe.transitionGrammar?.limits || {};
    for (const [role, limit] of Object.entries(limits)) {
      const count = recipe.scenes.filter((scene) => scene.transitionRole === role).length;
      assert.ok(count <= limit, `${recipe.id} authors ${count} ${role} beats but caps them at ${limit}`);
    }
  }
});

test("six-frame montage recipes author all six supported photo slots", () => {
  const sixFrameEffects = new Set(["collage_grid", "memory_wall"]);
  for (const recipe of recipes) {
    for (const scene of recipe.scenes.filter((item) => sixFrameEffects.has(item.effect))) {
      const slot = scene.photoSlots?.[0];
      assert.equal(
        slot?.count,
        6,
        `${recipe.id}/${scene.id} authors ${slot?.count ?? 0} photos for ${scene.effect}; expected 6`,
      );
    }
  }
});

test("fixed montage grids keep their authored photo count under gentle pacing", () => {
  const scene = {
    id: "six-grid",
    effect: "collage_grid",
    photoSlots: [{ slot: "grid", count: 6, fixedCount: true }],
  };
  const [request] = buildPhotoAssignmentRequests({
    scenes: [scene],
    library: { layouts: [] },
    direction: { pacing: { controls: { montagePhotoMultiplier: 0.8 } } },
  });
  assert.equal(request.count, 6);
});

test("gentle pacing does not shrink multi-photo hybrid scenes", () => {
  const scene = {
    id: "hybrid-filmstrip",
    effect: "still",
    renderer: "remotion",
    template: "match_cut_windows",
    photoSlots: [{ slot: "assets", count: 3 }],
  };
  const direction = { pacing: { controls: { montagePhotoMultiplier: 0.8 } } };
  const [request] = buildPhotoAssignmentRequests({
    scenes: [{ id: "opening", effect: "video_background" }, scene],
    library: { layouts: [] },
    direction,
  });

  assert.equal(request.count, 3);
  assert.equal(scenePhotoCount(scene, { direction }), request.count);
});

// Both of these ask "how many different PICTURES", so both resolve the recipe first: a
// scene may name its composition through a look rather than a layout, and two recipes on
// one layout are two different pictures once their own looks dress it.
const resolved = new Map(recipes.map((recipe) =>
  [recipe.id, resolveTemplate(recipe, { library }).scenes]));

test("every recipe offers at least seven distinct authored layout looks", () => {
  for (const recipe of recipes) {
    const looks = new Set(
      resolved.get(recipe.id)
        .filter((scene) => scene.effect === "layer_scene")
        .map(visualSignature),
    );
    assert.ok(
      looks.size >= 7,
      `${recipe.id} has ${looks.size} authored layout looks; expected at least 7`,
    );
  }
});

// Every composition a recipe can put on screen, including the two the solver reaches for
// on its own: a wordless recurrence's muteFallback, and each repeat variant that swaps the
// picture. On a long film those beats hold most of the screen time, so leaving them out
// would measure a recipe by scenes the viewer spends the least time looking at.
const compositionsOf = (recipe) => {
  const seen = new Set();
  const add = (scene, alternative) => {
    const merged = { ...scene, ...(alternative || {}) };
    if (alternative?.look) delete merged.layout;
    else if (alternative?.layout) delete merged.look;
    const [only] = resolveTemplate({ ...recipe, scenes: [merged] }, { library }).scenes;
    const signature = only && visualSignature(only);
    if (signature) seen.add(signature);
  };
  for (const scene of recipe.scenes || []) {
    if (scene.effect !== "layer_scene") continue;
    add(scene, null);
    if (scene.muteFallback) add(scene, scene.muteFallback);
    for (const variant of scene.repeatable?.variants || []) {
      if (variant.look || variant.layout) add(scene, variant);
    }
  }
  return seen;
};

// Two recipes are two products. They may share the library's geometry — that is what a
// shared layout library is FOR — but a couple choosing between them must not be shown the
// same film twice, so each recipe dresses those primitives in its own frame language, type
// scale and grade (its `layoutPresets` entry plus its `looks`). The bar: any two recipes
// differ in at least two thirds of their compositions.
//
// This is the regression that let the per-theme `*_plate` generator ship: it wrote one
// frame per libraryTheme, so all nine white_weddings recipes wore byte-identical looks and
// the nearest pair overlapped 75%. Nothing measured it, because every existing check reads
// ONE recipe at a time.
test("no two recipes share more than a third of their compositions", () => {
  const sets = new Map(recipes.map((recipe) => [recipe.id, compositionsOf(recipe)]));
  const offenders = [];
  for (let i = 0; i < recipes.length; i++) {
    for (let j = i + 1; j < recipes.length; j++) {
      const a = sets.get(recipes[i].id);
      const b = sets.get(recipes[j].id);
      const shared = [...a].filter((signature) => b.has(signature));
      const overlap = shared.length / Math.min(a.size, b.size);
      if (overlap > 1 / 3) {
        offenders.push(`${recipes[i].id} ~ ${recipes[j].id}: ${shared.length}/${Math.min(a.size, b.size)} (${(overlap * 100).toFixed(0)}%)`);
      }
    }
  }
  assert.deepEqual(offenders, [], `recipe pairs that look like each other:\n  ${offenders.join("\n  ")}`);
});

test("scalable gallery tails do not collapse back to one shared look sequence", () => {
  const signatures = recipes.map((recipe) => {
    const tail = resolved.get(recipe.id)
      .filter((scene) => /^s8[345]_/.test(scene.id))
      .map(visualSignature);
    assert.equal(tail.length, 3, `${recipe.id} must author three scalable tail looks`);
    return tail.join(" > ");
  });
  const clashes = signatures.filter((s, i) => signatures.indexOf(s) !== i);
  assert.deepEqual(
    clashes, [],
    `every recipe must own a distinct scalable gallery look sequence; shared: ${[...new Set(clashes)].join(" | ")}`,
  );
});

test("cinematic gallery keeps portrait-safe contain crops on a light matte", () => {
  const gallery = resolved.get("cinematic-film-01")
    .find((scene) => scene.id === "s83_gallery_matte");

  assert.deepEqual(
    gallery.resolvedLayout.background,
    { type: "tint", color: "#D8CFC0" },
  );
});

test("photo-rich recipe tails have distinct treatment sequences", () => {
  const tails = recipes
    .map((recipe) => ({
      id: recipe.id,
      scenes: resolved.get(recipe.id).filter((scene) => /^s8[0-2]_/.test(scene.id)),
    }))
    .filter(({ scenes }) => scenes.length > 0);

  const sequences = tails.map(({ id, scenes }) => {
    assert.equal(scenes.length, 3, `${id} must author all three photo-rich tail beats`);
    return scenes.map(visualSignature).join(" > ");
  });
  const clashes = sequences.filter((sequence, index) => sequences.indexOf(sequence) !== index);
  assert.deepEqual(
    clashes,
    [],
    `recipe tails must not share one treatment sequence: ${[...new Set(clashes)].join(" | ")}`,
  );

  const usage = new Map();
  for (const { scenes } of tails) {
    for (const scene of scenes) {
      const signature = visualSignature(scene);
      usage.set(signature, (usage.get(signature) || 0) + 1);
    }
  }
  const maxShared = Math.ceil(tails.length / 3);
  for (const [signature, count] of usage) {
    assert.ok(
      count <= maxShared,
      `${signature} occupies ${count}/${tails.length * 3} photo-rich tail beats; cap is ${maxShared}`,
    );
  }
});

test("Across the Miles keeps one heading family and a readable type scale", () => {
  const recipe = recipes.find((item) => item.id === "long-distance-love-01");
  assert.equal(recipe.defaults.fonts.title, recipe.defaults.fonts.heading);

  const scenes = resolved.get(recipe.id);
  for (const scene of scenes.filter((item) => item.effect === "layer_scene" && item.text)) {
    for (const slot of scene.resolvedLayout?.textSlots || []) {
      if (!scene.text[slot.id]) continue;
      const minimum = slot.fontRole === "body" ? 32 : 68;
      assert.ok(
        slot.sizePx >= minimum,
        `${recipe.id}/${scene.id}/${slot.id} is ${slot.sizePx}px; expected at least ${minimum}px`,
      );
    }
  }
});

test("authored text does not sit on photos without a protective panel", () => {
  const intersection = (a, b) => {
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), width, height };
  };
  const area = (box) => box.width * box.height;

  for (const recipe of recipes) {
    for (const scene of resolved.get(recipe.id).filter((item) => item.effect === "layer_scene" && item.text)) {
      const layout = scene.resolvedLayout;
      const backgroundSlot = layout.background?.type === "photo_full_bleed"
        ? layout.background.slot
        : null;
      const panels = (layout.panels || []).filter((panel) => panel.z === "over_photos");

      for (const textSlot of layout.textSlots || []) {
        if (!scene.text[textSlot.id]) continue;
        for (const photoSlot of (layout.photoSlots || []).filter((slot) => slot.id !== backgroundSlot)) {
          const collision = intersection(textSlot, photoSlot);
          const collisionArea = area(collision);
          if (!collisionArea) continue;

          const protectedArea = panels.reduce(
            (largest, panel) => Math.max(largest, area(intersection(collision, panel))),
            0,
          );
          assert.ok(
            protectedArea / collisionArea >= 0.8,
            `${recipe.id}/${scene.id}: text ${textSlot.id} overlaps photo ${photoSlot.id} without a protective panel`,
          );
        }
      }
    }
  }
});

test("every template owns two or three advanced signature scenes", () => {
  const advanced = new Set(["mask_reveal", "double_exposure", "video_background", "portrait_reflection", "floating_card_gallery", "moving_background_echo", "panel_flip"]);
  for (const recipe of recipes) {
    const signatures = recipe.scenes.filter((scene) => scene.signature);
    const hybrids = recipe.scenes.filter((scene) => scene.renderer && scene.template);
    assert.ok(hybrids.length >= 2 && hybrids.length <= 3, `${recipe.id} has ${hybrids.length} hybrid signature scenes; expected 2-3`);
    assert.ok(signatures.some((scene) => advanced.has(scene.effect) || scene.renderer === "remotion" || scene.renderer === "blender"), `${recipe.id} signature is not an advanced effect`);
  }
});

// Recipes are AUTHORED in Vietnamese; an English film is made by rewriting them
// (lib/recipeCopyPolicy.mjs runs writeRecipeCopy.mjs only for language "en"). So a recipe
// authored in English has no rewrite step on the default vi path — it simply ships in the
// wrong language. classic-multisong-album-01 and studio-white-prewedding-01 both did, with
// their own intro prose written in Vietnamese, and every vi job on them raised QA's
// caption_language finding for a defect that lives in the recipe file.
test("every recipe's authored copy is Vietnamese", () => {
  for (const recipe of recipes) {
    const copy = [];
    const collect = (value) => {
      if (typeof value === "string") copy.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") collect(value.value);
    };
    for (const scene of recipe.scenes) {
      for (const source of [scene, scene.muteFallback, ...(scene.repeatable?.variants ?? [])]) {
        if (!source) continue;
        Object.values(source.text ?? {}).forEach(collect);
        collect(source.captionPattern);
      }
    }
    // The same detector QA runs on the finished film, so passing here means the film cannot
    // be flagged for the recipe's own words.
    const verdict = inspectCaptionLanguage(copy, "vi");
    assert.ok(
      !verdict.flags.includes("wrong_caption_language"),
      `${recipe.id}: ${copy.length} authored string(s) carry no Vietnamese (${verdict.signals.enWords} English words)`,
    );
  }
});

// End-to-end on the recipe and settings from the real report: two songs chosen, musicMode
// "full_song" (the intake dropdown has no playlist option), language vi, and no brief — the
// three things that each used to leak English or drop a track.
test("a two-song Vietnamese job keeps both tracks and puts no English on screen", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "multisong-vi-"));
  const names = [`multisong-a-${process.pid}-${Date.now()}`, `multisong-b-${process.pid}-${Date.now()}`];
  const analyses = names.map((name) => path.join(root, "analysis", "music", `${name}.json`));
  t.after(() => {
    fs.rmSync(temp, { recursive: true, force: true });
    for (const file of analyses) fs.rmSync(file, { force: true });
  });

  const durations = [190, 255];
  analyses.forEach((file, index) => fs.writeFileSync(file, JSON.stringify({
    analysisVersion: 2,
    duration: durations[index],
    beatGrid: { beatSeconds: 0.5, phase: 0, source: "test" },
    phrases: Array.from({ length: Math.floor(durations[index] / 8) }, (_, i) => ({ index: i, time: i * 8, kind: "phrase" })),
    envelope: Array.from({ length: durations[index] * 2 }, () => 0.5),
  })));

  const photosPath = path.join(temp, "photos.json");
  const outPath = path.join(temp, "timeline.json");
  fs.writeFileSync(photosPath, JSON.stringify({
    photos: Array.from({ length: 130 }, (_, i) => ({
      file: `input/${String(i + 1).padStart(3, "0")}.jpg`,
      w: 1920, h: 1080,
      orient: i % 3 ? "landscape" : "portrait",
      qualityNorm: 0.9 - i / 1000,
      sharpness: 30, meanLuma: 128,
      focusX: 0.5, focusY: 0.45,
    })),
  }));

  const result = spawnSync(process.execPath, [
    "scripts/applyStoryTemplate.mjs",
    "--template", "story-templates/classic-multisong-album-01.json",
    "--photos", photosPath,
    "--music", `music/${names[0]}.mp3`,
    "--extra-music", `music/${names[1]}.mp3`,
    "--out", outPath,
    "--language", "vi",
    "--music-mode", "full_song",
    "--accept-misfit",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const timeline = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(timeline.music.length, 2, "both chosen songs must reach the timeline");
  assert.equal(timeline.music[1].path, `music/${names[1]}.mp3`);
  assert.equal(timeline.recipeDecisions.musicEdit.mode, "playlist");
  assert.equal(timeline.recipeDecisions.musicEdit.promotedFrom, "full_song");
  assert.ok(timeline.audio.crossfade > 0, "a playlist needs a crossfade to join its tracks");
  // 190 + 255 with one 2s crossfade eaten at the joint.
  assert.equal(timeline.recipeDecisions.musicEdit.sourceDuration, 443);

  const visible = timeline.slides.flatMap((slide) => [
    ...(slide.captions || []).map((caption) => caption.text),
    ...(slide.layers || []).filter((layer) => layer.type === "text").map((layer) => layer.text),
  ]).filter(Boolean);
  const language = inspectCaptionLanguage(visible, "vi");
  assert.equal(language.flagged, 0, `English on screen: ${JSON.stringify(visible)}`);
  // No --brief, so every token fell back. Those fallbacks are copy and follow --language.
  assert.equal(language.signals.enWords, 0, `English token fallbacks: ${JSON.stringify(visible)}`);
});

test("recipe copy includes captionPattern in the language rewrite contract", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-copy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recipePath = path.join(dir, "recipe.json");
  const outPath = path.join(dir, "copy.json");
  fs.writeFileSync(recipePath, JSON.stringify({
    id: "caption-contract",
    name: "Caption Contract",
    scenes: [{
      id: "s01",
      captionPattern: ["Canned caption A", "Canned caption B"],
      text: { heading: ["Canned heading A", "Canned heading B"], names: "{{bride}} & {{groom}}" },
    }],
  }));
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  const run = spawnSync(process.execPath, [
    "scripts/writeRecipeCopy.mjs",
    "--recipe", recipePath,
    "--out", outPath,
    "--language", "vi",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const copy = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(copy.totalSlots, 2);
  assert.equal(copy.factSlotsWithheld, 1);
  assert.equal(copy.scenes.s01.captionPattern, "Canned caption A");
});
