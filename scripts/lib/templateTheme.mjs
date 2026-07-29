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

  function defaultTextColor(slot, layout) {
    if (layout.background?.type !== "photo_full_bleed") return themeInk();
    const centerX = slot.x + slot.width / 2;
    const centerY = slot.y + slot.height / 2;
    const backing = (layout.panels || []).find(
      (panel) => centerX >= panel.x
        && centerX <= panel.x + panel.width
        && centerY >= panel.y
        && centerY <= panel.y + panel.height
    );
    if (!backing || hexLuma(resolveColor(backing.color)) < 140) return "#FFFFFF";
    return themeInk();
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
