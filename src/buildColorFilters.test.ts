import assert from "node:assert/strict";
import test from "node:test";

import { buildColorFilter } from "./buildColorFilters";

test("halation isolates highlights and screen-blends a warm tint, unlike neutral glow", () => {
  const filter = buildColorFilter({ halation: 1 });
  assert.ok(filter, "expected a filter string");
  assert.match(filter!, /lutrgb=r='if\(gte\(val,178\),val,0\)/);
  assert.match(filter!, /colorbalance=rm=0\.32/);
  assert.match(filter!, /blend=all_mode=screen:all_opacity=0\.500/);
});

test("halation strength scales the screen-blend opacity", () => {
  const filter = buildColorFilter({ halation: 0.6 });
  assert.match(filter!, /blend=all_mode=screen:all_opacity=0\.300/);
});

test("halation is a no-op at strength 0", () => {
  assert.equal(buildColorFilter({ halation: 0 }), undefined);
});

test("duotone maps shadow/highlight hex colors into a geq luma gradient", () => {
  const filter = buildColorFilter({
    duotone: { shadow: "#1a2a3a", highlight: "#f5e6c8" },
  });
  assert.ok(filter, "expected a filter string");
  assert.match(filter!, /format=yuv444p,geq=lum='/);
  // The gradient position comes from the frame's OWN luma, re-sampled via lum(X,Y).
  assert.match(filter!, /lum\(X,Y\)\/255/);
});

test("duotone's color output actually depends on the shadow/highlight colors given", () => {
  const dark = buildColorFilter({ duotone: { shadow: "#000000", highlight: "#101010" } })!;
  const light = buildColorFilter({ duotone: { shadow: "#e0e0e0", highlight: "#ffffff" } })!;
  assert.notEqual(dark, light);
});

test("vhs combines chroma smear, scanlines, tracking jitter and grain into one self-contained pass", () => {
  const filter = buildColorFilter({ vhs: 1 });
  assert.ok(filter, "expected a filter string");
  assert.match(filter!, /rgbashift=rh=3:bh=-3:edge=smear/);
  assert.match(filter!, /mod\(floor\(Y\/2\),2\)/);
  assert.match(filter!, /sin\(2\*PI\*t\*13\)/);
  assert.match(filter!, /noise=alls=4:allf=t\+u/);
});

test("vhs is a no-op at strength 0", () => {
  assert.equal(buildColorFilter({ vhs: 0 }), undefined);
});

test("halation, duotone and vhs compose with existing grade fields in one chain", () => {
  const filter = buildColorFilter({
    grain: 10,
    halation: 0.4,
    duotone: { shadow: "#000000", highlight: "#ffffff" },
    vhs: 0.5,
  });
  assert.ok(filter, "expected a filter string");
  // halation -> duotone -> ... -> vhs -> grain, matching buildColorFilter's documented order.
  const halationAt = filter!.indexOf("lutrgb=r=");
  const duotoneAt = filter!.indexOf("format=yuv444p,geq=lum=");
  const vhsAt = filter!.indexOf("sin(2*PI*t*13)");
  const grainAt = filter!.lastIndexOf("noise=alls=10:allf=t+u");
  assert.ok(halationAt >= 0 && duotoneAt >= 0 && vhsAt >= 0 && grainAt >= 0);
  assert.ok(halationAt < duotoneAt && duotoneAt < vhsAt && vhsAt < grainAt);
});
