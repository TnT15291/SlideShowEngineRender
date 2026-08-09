import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const assets = [
  "assets/backgrounds/snow-white/snow-white-silk-frost.png",
  "assets/backgrounds/snow-white/snow-white-winter-garden.png",
  "assets/overlays/snow-white/snow-dust-screen.png",
  "assets/overlays/snow-white/frosted-edge-screen.png",
];

function pngDimensions(file) {
  const header = fs.readFileSync(file).subarray(0, 24);
  assert.equal(header.toString("ascii", 1, 4), "PNG", `${file} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

test("snow-white assets are render-ready 1920x1080 PNGs", () => {
  for (const file of assets) {
    assert.ok(fs.existsSync(file), `${file} is missing`);
    assert.deepEqual(pngDimensions(file), { width: 1920, height: 1080 });
  }
});

test("snow-white assets are discoverable with safe compositing metadata", () => {
  const catalog = JSON.parse(fs.readFileSync("analysis/assets_catalog.full.json", "utf8"));
  const byPath = new Map([...catalog.backgrounds, ...catalog.overlays].map((asset) => [asset.path, asset]));

  for (const file of assets) {
    const asset = byPath.get(file);
    assert.ok(asset, `${file} is missing from the generated asset catalog`);
    assert.equal(asset.source, "local-ai-generated");
    assert.equal(asset.license, "project-owned");
  }

  for (const file of assets.filter((file) => file.includes("/overlays/"))) {
    const overlay = byPath.get(file);
    assert.equal(overlay.recommendedBlend, "screen");
    assert.ok(overlay.recommendedOpacity <= 0.3, `${file} would overpower the photographs`);
  }
});
