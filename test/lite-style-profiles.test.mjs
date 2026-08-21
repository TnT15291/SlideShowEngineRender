import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LITE_STYLE_PROFILES, resolveLiteStyleProfile } from "../scripts/lib/liteStyleProfiles.mjs";
import { SINGLE_PHOTO_EFFECTS, MONTAGE_EFFECTS, ALL_TRANSITIONS } from "../scripts/lib/engineCapabilities.mjs";

const LIBRARY = JSON.parse(fs.readFileSync(path.resolve("layouts/library.json"), "utf8"));

test("Lite ships exactly three verified initial style profiles", () => {
  assert.deepEqual(Object.keys(LITE_STYLE_PROFILES).sort(), ["editorial_clean", "warm_film_story", "white_wedding_gentle"]);
  for (const profile of Object.values(LITE_STYLE_PROFILES)) {
    assert.ok(profile.singlePhotoEffects.length >= 5);
    assert.ok(profile.singlePhotoEffects.every((effect) => SINGLE_PHOTO_EFFECTS.has(effect)));
    assert.ok(profile.montageEffects.every((effect) => MONTAGE_EFFECTS.has(effect)));
    assert.ok(profile.transitionPalette.every((transition) => ALL_TRANSITIONS.includes(transition)));
  }
});

test("Lite does not offer panel_flip after its real contact sheet proved unreadable", () => {
  for (const profile of Object.values(LITE_STYLE_PROFILES)) {
    assert.ok(!profile.singlePhotoEffects.includes("panel_flip"), `${profile.id} still offers panel_flip`);
  }
  assert.ok(LITE_STYLE_PROFILES.editorial_clean.singlePhotoEffects.includes("prism_split"));
});

// A profile must NOT carry fonts: `defaults.fonts` outranks the library theme in
// resolveFont(), so any value here silently replaces the theme's display face with a
// UI sans and every Lite film comes out in a single typeface.
test("Lite typography comes from the library theme, never a per-profile override", () => {
  const themes = LIBRARY.designTokens.themes;
  const headings = new Set();
  for (const profile of Object.values(LITE_STYLE_PROFILES)) {
    assert.equal(profile.fonts, undefined, `${profile.id} must not pin fonts`);
    const theme = themes[profile.libraryTheme];
    assert.ok(theme, `${profile.id} names unknown libraryTheme ${profile.libraryTheme}`);
    for (const role of ["heading", "script_accent", "body"]) {
      assert.ok(fs.existsSync(path.resolve(theme.fonts[role])),
        `${profile.libraryTheme}.${role} font missing: ${theme.fonts[role]}`);
    }
    // The display face is what separates a wedding title from body copy.
    assert.notEqual(theme.fonts.heading, theme.fonts.body, `${profile.libraryTheme} heading must not be the body sans`);
    headings.add(theme.fonts.heading);
  }
  // Three profiles that all resolve to one face would leave Lite as monotonous as before.
  assert.equal(headings.size, 3, "each Lite profile should reach a distinct display face");
});

test("style resolution is deterministic and records prompt/fallback provenance", () => {
  assert.equal(resolveLiteStyleProfile({ prompt: "Một thước phim ấm áp vintage" }).profile.id, "warm_film_story");
  assert.equal(resolveLiteStyleProfile({ prompt: "Editorial clean, tối giản" }).profile.id, "editorial_clean");
  assert.deepEqual(resolveLiteStyleProfile({ prompt: "Không có từ khóa" }), {
    profile: LITE_STYLE_PROFILES.white_wedding_gentle, provenance: "fallback",
  });
  assert.throws(() => resolveLiteStyleProfile({ requested: "invented" }), /Unknown Lite style profile/);
});
