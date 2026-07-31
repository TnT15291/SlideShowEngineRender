import assert from "node:assert/strict";
import test from "node:test";

import { faceCropLoss, faceFitsCoverCrop } from "./imageSize";

function closeTo(actual: number, expected: number, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be close to ${expected}`);
}

test("faceCropLoss is 0 when the face sits fully inside the surviving crop window", () => {
  // 1600x1067 into 1920x1080 only trims the vertical axis; a small centered
  // face is nowhere near either surviving edge.
  const loss = faceCropLoss({ x: 0.4, y: 0.3, width: 0.2, height: 0.2 }, { width: 1600, height: 1067 }, 1920, 1080, 0.5, 0.4);
  closeTo(loss, 0);
});

test("faceCropLoss is 1 when the face falls entirely outside the surviving crop window", () => {
  // Focus pinned to the very top (focusY=0) keeps only the top slice of a
  // portrait image; a face box anchored at the bottom never overlaps it.
  const loss = faceCropLoss({ x: 0.4, y: 0.9, width: 0.1, height: 0.08 }, { width: 884, height: 1280 }, 1920, 1080, 0.5, 0);
  closeTo(loss, 1);
});

test("faceCropLoss matches hand-computed geometry for a partially-clipped face", () => {
  // Same numbers as test/face-safe-framing.test.mjs's "portrait contain with
  // zoom" case: 884x1280 into 1920x1080, focusY=0.3. Worked out by hand in
  // review: ~44.5% of the face's area falls outside the surviving window.
  const loss = faceCropLoss({ x: 0.3, y: 0.05, width: 0.4, height: 0.3 }, { width: 884, height: 1280 }, 1920, 1080, 0.5, 0.3);
  closeTo(loss, 0.4449, 0.001);
});

test("faceCropLoss reports 0 (safe) when the source image size is unknown", () => {
  const loss = faceCropLoss({ x: 0.4, y: 0.9, width: 0.1, height: 0.08 }, undefined, 1920, 1080, 0.5, 0);
  closeTo(loss, 0);
});

test("faceFitsCoverCrop is true for a small face well inside the surviving window", () => {
  assert.equal(
    faceFitsCoverCrop({ x: 0.4, y: 0.3, width: 0.2, height: 0.2 }, { width: 1600, height: 1067 }, 1920, 1080),
    true,
  );
});

test("faceFitsCoverCrop is false when the face spans more than the surviving window on any axis", () => {
  // Same image pair as the fit-test above, but the face spans 0.02..0.88
  // vertically — wider than the ~84%-of-height window any offset can offer.
  assert.equal(
    faceFitsCoverCrop({ x: 0.3, y: 0.02, width: 0.3, height: 0.86 }, { width: 1600, height: 1067 }, 1920, 1080),
    false,
  );
});

test("faceFitsCoverCrop treats an unknown source size as always fitting", () => {
  assert.equal(
    faceFitsCoverCrop({ x: 0.3, y: 0.02, width: 0.3, height: 0.86 }, undefined, 1920, 1080),
    true,
  );
});
