export function createTemplateTheme({ library, template, direction }) {
  // direction.style.themeId (chooseTier1Direction.mjs) already resolves to the
  // recipe's own libraryTheme — a curated recipe's layouts/panels are built
  // for that one palette, so this never guesses a different theme from
  // customerPrompt wording. template.libraryTheme is the fallback for callers
  // that skip the direction step entirely.
  const themeRef = direction?.style?.themeId || template.libraryTheme || "white_weddings";
  const libTheme = () => {
    const base = (library.designTokens?.themes || {})[themeRef] || {};
    const palette = template.defaults?.palette || {};
    const fonts = template.defaults?.fonts || {};
    return {
      ...base,
      ...(palette.cream ? { background: palette.cream } : {}),
      palette: {
        ...base.palette,
        ...(palette.cream ? { cream_bg: palette.cream } : {}),
        ...(palette.ink ? { ink_dark: palette.ink, text: palette.ink } : {}),
        ...(palette.brown ? { warm_brown: palette.brown, accent: palette.brown } : {}),
        ...(palette.white ? { numeral_white: palette.white } : {}),
      },
      fonts: {
        ...base.fonts,
        ...(fonts.title ? { script_accent: fonts.title } : {}),
        ...(fonts.heading ? { heading: fonts.heading } : {}),
        ...(fonts.body ? { body: fonts.body } : {}),
      },
    };
  };

  function resolveColor(spec) {
    if (typeof spec !== "string") return "#000000";
    if (spec.startsWith("theme.")) {
      const theme = libTheme();
      return theme.palette?.[spec.slice(6)] || theme.background || "#000000";
    }
    return spec;
  }

  function resolveFont(role) {
    const theme = libTheme();
    return template.defaults?.fonts?.[role]
      || theme.fonts?.[role]
      || template.defaults?.fonts?.body
      || "fonts/BeVietnamPro-Regular.ttf";
  }

  function resolveFrame(name) {
    if (!name) return undefined;
    if (typeof name === "object") return name;
    return template.layoutPresets?.[name]
      || library.designTokens?.framePreset?.[name]
      || undefined;
  }

  function hexLuma(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!match) return 255;
    const value = parseInt(match[1], 16);
    return 0.2126 * ((value >> 16) & 255)
      + 0.7152 * ((value >> 8) & 255)
      + 0.0722 * (value & 255);
  }

  function themeInk() {
    const palette = libTheme().palette || {};
    return palette.text
      || palette.warm_brown
      || palette.ink_dark
      || "#2D2D33";
  }

  const LIGHT_BACKDROP = 140;  // luma above this reads as a light surface
  const MIN_SEPARATION = 60;   // luma gap below which text washes into its backdrop

  /** The theme ink is the intended colour — keep it wherever it actually separates
   *  from what sits behind it, and fall back to plain black/white where it does not. */
  function contrastingInk(backdrop) {
    const ink = themeInk();
    const bg = hexLuma(backdrop);
    if (Math.abs(hexLuma(ink) - bg) >= MIN_SEPARATION) return ink;
    return bg >= LIGHT_BACKDROP ? "#1C1712" : "#FFFFFF";
  }

  function panelBehind(slot, layout) {
    const centerX = slot.x + slot.width / 2;
    const centerY = slot.y + slot.height / 2;
    return (layout.panels || []).find(
      (panel) => centerX >= panel.x
        && centerX <= panel.x + panel.width
        && centerY >= panel.y
        && centerY <= panel.y + panel.height
    );
  }

  function defaultTextColor(slot, layout) {
    // The panel test used to run only for photo_full_bleed layouts, so a solid-fill
    // layout handed back themeInk() no matter what was drawn on top of the fill. A
    // theme's ink is picked to sit on ITS OWN background: heritage-ceremony's pale
    // gold is chosen against near-black lacquer, and paper_collage then draws a
    // #FFF9E9 paper note under the heading — gold on cream, all but invisible. What
    // backs the text decides its colour, whatever is behind that.
    const onPhoto = layout.background?.type === "photo_full_bleed";
    const backing = panelBehind(slot, layout);
    if (!backing) return onPhoto ? "#FFFFFF" : themeInk();
    const backdrop = resolveColor(backing.color);
    // A dark scrim over an unknown photo stays plain white, as it always has.
    if (onPhoto && hexLuma(backdrop) < LIGHT_BACKDROP) return "#FFFFFF";
    return contrastingInk(backdrop);
  }

  const stagger = () => library.designTokens?.motionPresets?.staggerSeconds || {};

  /** How long after the cut each successive photo enters. A recipe look may set its own
   *  step — a triptych that snaps in and one that unfolds are different pictures made of
   *  the same rectangles — falling back to the library's shared rhythm. */
  function photoStart(index, scene) {
    const values = stagger();
    const step = scene?.resolvedMotion?.stagger ?? values.photoStep ?? 0.1;
    return +((values.photoBase ?? 0.15) + index * step).toFixed(2);
  }

  function textStart(role) {
    const values = stagger();
    return ["heading", "eyebrow", "display", "names"].includes(role)
      ? (values.heading ?? 0.2)
      : (values.body ?? 0.5);
  }

  return {
    themeRef,
    libTheme,
    resolveColor,
    resolveFont,
    resolveFrame,
    defaultTextColor,
    photoStart,
    textStart,
  };
}
