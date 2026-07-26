export function createTemplateTheme({ library, template, customerPrompt, direction }) {
  const styleRules = [
    { match: /editorial|tạp chí|thời trang|fashion/, theme: "editorial_bold" },
    { match: /hiện đại|modern|minimal|tối giản|teal/, theme: "modern_teal" },
    { match: /điện ảnh|cinematic|moody|trầm|dark/, theme: "dark_film" },
    { match: /hoài niệm|vintage|film|ấm|warm|mộc/, theme: "warm_film" },
  ];
  const requestedTheme = styleRules.find((rule) => rule.match.test(customerPrompt))?.theme;
  const themeRef = direction?.style?.themeId
    || (requestedTheme && library.designTokens?.themes?.[requestedTheme]
      ? requestedTheme
      : (template.libraryTheme || "white_weddings"));
  const libTheme = () => (library.designTokens?.themes || {})[themeRef] || {};

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
    return theme.fonts?.[role]
      || template.defaults?.fonts?.[role]
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
      || template.defaults?.palette?.brown
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

  function photoStart(index) {
    const values = stagger();
    return +((values.photoBase ?? 0.15) + index * (values.photoStep ?? 0.1)).toFixed(2);
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
