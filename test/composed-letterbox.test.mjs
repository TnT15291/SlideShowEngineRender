// A film with cinematic bars must not compose cards whose words fall under them.
//
// The bars are painted over the finished card, so a layer_scene's own text sits UNDER them
// — and nothing else notices: the bars are inside the canvas so the bounds check passes,
// they are below the 5% title-safe margin so the layout rules pass, and the text still fits
// its own slot so the QA measurer passes. preflightTimeline stops the render when it sees
// it, which is right for an authored recipe a person can fix and fatal for a composed film
// nobody authored. So the composer never reaches for those layouts in the first place.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { composeStoryboard } from "../scripts/lib/storyboard.mjs";
import { makeEnergy } from "../scripts/lib/pacing.mjs";
import { letterboxBarHeight, textSlotsClearLetterbox } from "../scripts/lib/rules/thresholds.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const layoutById = new Map(library.layouts.map((l) => [l.id, l]));
const canvas = { width: 1920, height: 1080 };
const track = (seconds) =>
  makeEnergy({ duration: seconds, envelope: Array(Math.round(seconds / 0.5)).fill(0.5) });

/** The grade dark_film actually carries — the only shipping theme that draws bars. */
const darkFilm = library.designTokens.themes.dark_film.colorGrade;

// The arithmetic is stated twice: here for the script layer, and in
// src/buildColorFilters.ts for the renderer, which src/preflightTimeline.test.ts pins to
// the same 138px. If either drifts, one of the two suites goes red.
test("a 2.39 grade on a 1080p canvas means 138px bars, the same number the renderer paints", () => {
  assert.equal(letterboxBarHeight(darkFilm, canvas), 138);
  assert.equal(letterboxBarHeight({ letterbox: true }, canvas), 138, "bare `letterbox: true` means 2.39");
  assert.equal(letterboxBarHeight({ letterbox: false }, canvas), 0);
  assert.equal(letterboxBarHeight(undefined, canvas), 0);
});

test("the slot test judges the first line, not the slot box", () => {
  const bar = 138;
  // full_bleed_quote's box runs to y=1000, into the bottom bar; its one 56px line does not.
  // cinematic-film-01 ships this card, and excluding it would cost a composition for nothing.
  assert.equal(textSlotsClearLetterbox(layoutById.get("full_bleed_quote"), bar, canvas), true);
  // three_photo_row's heading STARTS at y=91, above the bar. No line count saves it.
  assert.equal(textSlotsClearLetterbox(layoutById.get("three_photo_row"), bar, canvas), false);
  assert.equal(textSlotsClearLetterbox(layoutById.get("three_photo_row"), 0, canvas), true, "no bars, no rule");
});

/** Every layout the shot list reached for, in library order. */
const layoutsUsed = (sb) => [...new Set(sb.scenes.filter((s) => s.layout).map((s) => s.layout))];

test("a letterboxed film composes no card whose text a bar would hide", () => {
  // Photo-rich and long, so the composer spends as much of the layout vocabulary as it can.
  const sb = composeStoryboard({
    photoCount: 180, musicDuration: 240, energy: track(240), library,
    color: darkFilm, canvas,
  });
  const used = layoutsUsed(sb);
  assert.ok(used.length >= 3, `only ${used.length} layout(s) used — too few to prove anything`);
  for (const id of used) {
    assert.ok(textSlotsClearLetterbox(layoutById.get(id), 138, canvas),
      `composed a ${id} card into a film with 138px bars`);
  }
});

test("without bars the same job keeps the whole vocabulary", () => {
  const args = { photoCount: 180, musicDuration: 240, energy: track(240), library, canvas };
  const graded = layoutsUsed(composeStoryboard({ ...args, color: darkFilm }));
  const ungraded = layoutsUsed(composeStoryboard({ ...args, color: { saturation: 0.9 } }));
  // The filter must be the letterbox and nothing else: an ungraded film is free to use the
  // layouts a letterboxed one may not, and at least one of them is how we know the filter
  // is doing something rather than passing everything through.
  const excluded = ungraded.filter((id) => !textSlotsClearLetterbox(layoutById.get(id), 138, canvas));
  assert.ok(excluded.length > 0, "this job never picked a bar-clashing layout — it cannot prove the filter works");
  for (const id of excluded) assert.ok(!graded.includes(id), `${id} survived into the letterboxed film`);
});

test("no photo count is left without a layout to render it", () => {
  // The filter narrows the buckets; a bucket it emptied would be a worse defect than the
  // bars, because the composer could not render that photo count at all.
  const bar = 138;
  const byCount = new Map();
  for (const l of library.layouts) {
    const n = (l.photoSlots || []).length;
    byCount.set(n, [...(byCount.get(n) || []), l]);
  }
  for (const [n, layouts] of byCount) {
    const clear = layouts.filter((l) => textSlotsClearLetterbox(l, bar, canvas));
    assert.ok(clear.length, `every ${n}-photo layout puts text under a 2.39 bar`);
  }
});
