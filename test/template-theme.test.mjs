import assert from "node:assert/strict";
import test from "node:test";
import { createTemplateTheme } from "../scripts/lib/templateTheme.mjs";

const library = {
  designTokens: {
    themes: {
      shared: {
        background: "#BASE00",
        palette: {
          cream_bg: "#BASE01",
          ink_dark: "#BASE02",
          text: "#BASE03",
          warm_brown: "#BASE04",
          accent: "#BASE05",
          numeral_white: "#BASE06",
        },
        fonts: {
          heading: "base-heading.ttf",
          script_accent: "base-script.ttf",
          body: "base-body.ttf",
        },
      },
    },
  },
};

test("recipe palette overrides the shared library theme for every authored scene", () => {
  const theme = createTemplateTheme({
    library,
    template: {
      libraryTheme: "shared",
      defaults: {
        palette: {
          cream: "#RECIPE1",
          ink: "#RECIPE2",
          brown: "#RECIPE3",
          white: "#RECIPE4",
        },
      },
    },
  }).libTheme();

  assert.equal(theme.background, "#RECIPE1");
  assert.equal(theme.palette.cream_bg, "#RECIPE1");
  assert.equal(theme.palette.ink_dark, "#RECIPE2");
  assert.equal(theme.palette.text, "#RECIPE2");
  assert.equal(theme.palette.warm_brown, "#RECIPE3");
  assert.equal(theme.palette.accent, "#RECIPE3");
  assert.equal(theme.palette.numeral_white, "#RECIPE4");
});

test("recipe typography overrides fonts inherited from a shared theme", () => {
  const resolved = createTemplateTheme({
    library,
    template: {
      libraryTheme: "shared",
      defaults: {
        fonts: {
          title: "recipe-title.ttf",
          heading: "recipe-heading.ttf",
          body: "recipe-body.ttf",
        },
      },
    },
  });

  assert.equal(resolved.resolveFont("heading"), "recipe-heading.ttf");
  assert.equal(resolved.resolveFont("body"), "recipe-body.ttf");
  assert.equal(resolved.resolveFont("script_accent"), "recipe-title.ttf");
});
