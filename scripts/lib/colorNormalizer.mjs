const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const round = (v) => +v.toFixed(4);
export function buildColorNormalization(photos) {
  const target = { luma: median(photos.map((p) => p.meanLuma ?? 128)), redGreen: median(photos.map((p) => (p.meanRgb?.r ?? 128) - (p.meanRgb?.g ?? 128))), blueGreen: median(photos.map((p) => (p.meanRgb?.b ?? 128) - (p.meanRgb?.g ?? 128))), saturation: median(photos.map((p) => p.colorfulness ?? 0.25)) };
  const decisions = photos.map((p) => {
    const conservative = (p.subjectCount ?? p.faces?.length ?? 0) > 0 ? 0.7 : 1;
    const brightness = round(clamp((target.luma - (p.meanLuma ?? target.luma)) / 255 * conservative, -0.12, 0.12));
    const redCast = ((p.meanRgb?.r ?? 128) - (p.meanRgb?.g ?? 128)) - target.redGreen;
    const blueCast = ((p.meanRgb?.b ?? 128) - (p.meanRgb?.g ?? 128)) - target.blueGreen;
    const redBalance = round(clamp(-redCast / 255 * conservative, -0.08, 0.08));
    const blueBalance = round(clamp(-blueCast / 255 * conservative, -0.08, 0.08));
    const saturation = round(clamp(target.saturation / Math.max(0.08, p.colorfulness ?? target.saturation), 0.9, 1.1));
    const clipped = (p.lumaP95 ?? 220) > 248 || (p.lumaP05 ?? 20) < 5;
    return { file: p.file, brightness, saturation, redBalance, blueBalance, confidence: p.meanRgb ? (clipped ? 0.65 : 0.9) : 0.3, reason: clipped ? "bounded album correction; clipped tonal range" : "album-relative exposure and color-cast correction" };
  });
  return { version: 1, method: "album_median_bounded", target, decisions };
}
export function averageAdjustments(rows) {
  if (!rows.length) return undefined;
  const mean = (key) => rows.reduce((n, r) => n + r[key], 0) / rows.length;
  return { brightness: round(mean("brightness")), saturation: round(mean("saturation")), redBalance: round(mean("redBalance")), blueBalance: round(mean("blueBalance")) };
}
