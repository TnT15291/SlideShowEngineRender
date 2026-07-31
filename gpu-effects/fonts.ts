import { useEffect } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

// WHY THIS FILE EXISTS
//
// Remotion draws in headless Chrome, and Chrome resolves `fontFamily` against the fonts
// installed on the RENDER HOST. Every text-bearing hybrid template used to name
// "Georgia, serif" — and Georgia has no glyph for the Vietnamese vowels that stack a tone
// mark on a circumflex (ố U+1ED1, ầ U+1EA7, …). Chrome then falls back per character, the
// mark loses its attachment to the base letter, and "Nguyễn Quốc & Trần Bảo Nhi" renders as
//
//     Nguyễn Quô ́c & Trâ ̀n Bảo Nhi
//
// on the peak beat of a Vietnamese wedding film. Rendering the same string in a font that
// covers the repertoire fixes it completely, so the answer is to SHIP the font rather than
// hope the host has one. All 18 TTFs in fonts/ were checked against the full Vietnamese
// repertoire (every precomposed vowel in U+1EA0–U+1EF9 plus ăâđêôơư) and all 18 cover it.
//
// Fonts are named by REPO PATH — "fonts/CormorantGaramond-Regular.ttf" — because that is
// already how layouts/library.json names the heading/script/body font of every theme. One
// convention, so a recipe can hand a hybrid scene the same font its theme uses. Anything
// that is not a bundled path (a plain CSS stack like "Georgia, serif") is passed through
// untouched and loads nothing.
//
// src/renderRemotionScene.ts publishes fonts/ into public/fonts/ so staticFile() can reach
// them; see publishFonts() there.

const BUNDLED = /^fonts\/([A-Za-z0-9_-]+)\.(?:ttf|otf|woff2?)$/i;

/** The family name Chrome will know a bundled font by: its file stem. */
export function bundledFontFamily(request: string): string | null {
  const match = BUNDLED.exec(String(request ?? "").trim());
  return match ? match[1] : null;
}

/**
 * Resolve `params.fontFamily` into a CSS font stack, loading the file first when it names
 * one of the bundled fonts. Returns the stack to put in `style.fontFamily`.
 *
 * The load is wrapped in delayRender so no frame is captured while the text is still
 * painted in the fallback face — a half-loaded font is exactly the silent wrong-font bug
 * this file exists to stop.
 */
export function useBundledFont(request: unknown, fallback = "Georgia, serif"): string {
  const requested = String(request ?? "").trim();
  const family = bundledFontFamily(requested);
  const url = family ? staticFile(requested) : "";

  useEffect(() => {
    if (!family || !url) return;
    const handle = delayRender(`hybrid font ${family}`);
    let cancelled = false;
    const face = new FontFace(family, `url("${url}")`);
    face
      .load()
      .then((loaded) => {
        if (!cancelled) document.fonts.add(loaded);
      })
      // A missing/corrupt file must not hang the render: fall through to the CSS fallback
      // stack, which is what Chrome would paint anyway.
      .catch(() => undefined)
      .finally(() => continueRender(handle));
    return () => {
      cancelled = true;
    };
  }, [family, url]);

  if (!family) return requested || fallback;
  return `"${family}", ${fallback}`;
}
