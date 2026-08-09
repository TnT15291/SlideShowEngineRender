import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { READING_UNITS_PER_SECOND, STORY_CARD_SECONDS, readingLimit, storyBodyBudget } from "../scripts/lib/textBudget.mjs";

test("the reading limit is the one the fitter enforces, not a second opinion", () => {
  assert.equal(readingLimit("vi"), 18);
  assert.equal(readingLimit("en"), 3);
  // Anything that is not English is measured the Vietnamese way, matching
  // `language === "en" ? … : …` everywhere downstream.
  assert.equal(readingLimit(undefined), 18);
  assert.equal(readingLimit("fr"), READING_UNITS_PER_SECOND.vi);
});

// The number in the prompt is only worth anything if it is the same number the
// pipeline cuts by. These two files used to hold their own copies of it.
test("no consumer keeps a private copy of the reading rate", () => {
  for (const file of ["scripts/fitTextInTimeline.mjs", "scripts/lib/liteQualityReport.mjs"]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(/textBudget\.mjs/.test(source), `${file} must take the limit from lib/textBudget.mjs`);
    assert.doesNotMatch(source, /\?\s*3\s*:\s*18/, `${file} still hardcodes the reading rate`);
  }
});

test("a story body budget is what fits its card, in the unit the fitter counts", () => {
  const vi = storyBodyBudget("vi");
  assert.equal(vi.units, STORY_CARD_SECONDS * 18);
  assert.equal(vi.unit, "characters excluding spaces");
  assert.match(vi.sentence, /90 characters excluding spaces/);
  assert.match(vi.sentence, /roughly 25 words/);

  const en = storyBodyBudget("en");
  assert.equal(en.units, STORY_CARD_SECONDS * 3);
  assert.equal(en.sentence, "at most 15 words");
});

// A body written to the budget must survive the fitter's reading-rate cut on a
// card of the assumed length; that is the whole point of the number.
test("prose written to the budget clears the reading-rate cut", () => {
  const budget = storyBodyBudget("vi");
  const body = "Giữa Sài Gòn hoa lệ, hai tâm hồn đồng hương tìm thấy nhau. Tình yêu nảy nở từ điều giản dị.";
  const units = body.replace(/\s/g, "").length;
  assert.ok(units <= budget.units, `fixture is ${units} units, over the ${budget.units} budget`);
  assert.ok(units / STORY_CARD_SECONDS <= readingLimit("vi"), "would be trimmed on its own card");
});

test("the story prompt tells the model the real budget", () => {
  const source = fs.readFileSync(new URL("../scripts/generateProjectStory.mjs", import.meta.url), "utf8");
  assert.ok(/storyBodyBudget/.test(source) && /budget\.sentence/.test(source),
    "the prompt must interpolate the shared budget rather than a literal it can drift from");
  assert.ok(/STORY_CARD_SECONDS/.test(source), "the prompt must state how long a card is on screen");
});
