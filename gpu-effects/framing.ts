// Shared framing helpers for the hybrid templates.
//
// `focusX`/`focusY` arrive in `params` from src/renderRemotionScene.ts, taken off the slide
// the same analysis fills in for every native effect: 0..1 of the SOURCE image, where the
// subject actually is. Without them a cover-fit crops from the centre, and a wedding
// portrait fitted into a wide tile loses the faces first — the tallest, most important part
// of the picture is exactly the part a centred crop throws away.

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * `object-position` for a cover-fitted photograph, from the slide's focal point.
 *
 * The default is 50% / 42% rather than dead centre: absent focus means "we do not know",
 * and for wedding photographs the safer guess is slightly high, where heads are.
 */
export function focusPosition(params: Record<string, unknown>): string {
  const x = Number(params.focusX);
  const y = Number(params.focusY);
  const px = clamp(Number.isFinite(x) ? x : 0.5, 0, 1) * 100;
  const py = clamp(Number.isFinite(y) ? y : 0.42, 0, 1) * 100;
  return `${px.toFixed(1)}% ${py.toFixed(1)}%`;
}

/** Horizontal focus as a plain number, for templates that need to decide which SIDE of the
 *  frame is free — where a caption can sit without landing on anybody's face. */
export function focusX(params: Record<string, unknown>): number {
  const x = Number(params.focusX);
  return clamp(Number.isFinite(x) ? x : 0.5, 0, 1);
}
