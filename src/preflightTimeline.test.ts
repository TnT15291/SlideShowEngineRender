import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Logger, ValidationError } from "./fileUtils";
import { preflightTimeline } from "./preflightTimeline";
import type { TextSceneLayer, Timeline } from "./types";

function workspace(context: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preflight-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, logger: new Logger(path.join(dir, "logs")) };
}

/** One layer-scene card: a text line on a plain rect, so nothing here touches
 *  the filesystem or an image probe and the only thing under test is geometry. */
function timelineWithText(text: Partial<TextSceneLayer> & { y: number }, letterbox?: boolean | number): Timeline {
  return {
    project: { name: "preflight", width: 1920, height: 1080, fps: 30, quality: "draft" },
    music: [],
    audio: { fade_in: 0, fade_out: 0, crossfade: 0 },
    output: { path: "out.mp4" },
    ...(letterbox === undefined ? {} : { color: { letterbox } }),
    overlays: [],
    slides: [{
      id: "card",
      duration: 4,
      effect: "layer_scene",
      transition: { type: "none", duration: 0 },
      captions: [],
      layers: [
        { type: "rect", x: 0, y: 0, width: 1920, height: 1080, color: "#000000", opacity: 1 },
        { type: "text", text: "Linh & Nam", font: "fonts/YesevaOne-Regular.ttf", size: 56, color: "#FFFFFF", align: "center", x: 260, width: 1400, height: 56, ...text },
      ],
    }],
  } as unknown as Timeline;
}

const preflight = (timeline: Timeline, dir: string, logger: Logger) => preflightTimeline(timeline, dir, logger, true);

test("preflight fails text that a cinematic bar would hide", async (context) => {
  const { dir, logger } = workspace(context);
  // Legal three ways over — inside the canvas, inside the 5% title-safe margin,
  // and measured as fitting its own slot — and invisible in the rendered frame.
  await assert.rejects(
    preflight(timelineWithText({ y: 970 }, 2.39), dir, logger),
    (error: unknown) => error instanceof ValidationError && /runs under the bottom letterbox bar/.test(error.message),
  );
  await assert.rejects(
    preflight(timelineWithText({ y: 90 }, 2.39), dir, logger),
    (error: unknown) => error instanceof ValidationError && /runs under the top letterbox bar/.test(error.message),
  );
});

test("preflight leaves letterboxed cards alone when the text clears the bars", async (context) => {
  const { dir, logger } = workspace(context);
  // The geometry cinematic-film-01 actually authors on full_bleed_quote: the
  // slot box reaches into the bar, the single line of glyphs does not. Judging
  // the box instead of the block would fail a card that renders correctly.
  await preflight(timelineWithText({ y: 820, height: 180, lineSpacing: 16 }, 2.39), dir, logger);
});

test("preflight only draws bars for a grade that asked for them", async (context) => {
  const { dir, logger } = workspace(context);
  await preflight(timelineWithText({ y: 970 }), dir, logger);
  await preflight(timelineWithText({ y: 970 }, false), dir, logger);
});

test("a two-line block is judged where the last line lands, not the first", async (context) => {
  const { dir, logger } = workspace(context);
  // fitTextInTimeline writes its wrap back as real newlines, so by preflight
  // the line count is a fact rather than an estimate: one line at y=860 clears
  // the 942px bar, two do not.
  await preflight(timelineWithText({ y: 860, height: 180 }, 2.39), dir, logger);
  await assert.rejects(
    preflight(timelineWithText({ y: 860, height: 180, text: "Linh & Nam\nChuyện đôi mình" }, 2.39), dir, logger),
    (error: unknown) => error instanceof ValidationError && /runs under the bottom letterbox bar/.test(error.message),
  );
});
