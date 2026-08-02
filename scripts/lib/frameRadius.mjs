export const MAX_FRAME_RADIUS = 540;

/** @returns {[number, number, number, number] | null} */
export function radiusCorners(radius) {
  if (typeof radius === "number") return [radius, radius, radius, radius];
  if (Array.isArray(radius) && radius.length === 4) {
    return [radius[0], radius[1], radius[2], radius[3]];
  }
  return null;
}

export function frameRadiusErrors(radius, width, height) {
  if (radius === undefined) return [];
  const corners = radiusCorners(radius);
  if (!corners || corners.some((corner) => !Number.isFinite(corner) || corner < 0)) {
    return ["radius must be a non-negative number or [tl, tr, br, bl] tuple"];
  }
  if (corners.some((corner) => corner > MAX_FRAME_RADIUS)) {
    return [`each radius must be <= ${MAX_FRAME_RADIUS}px`];
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];

  const [tl, tr, br, bl] = corners;
  const errors = [];
  const limit = Math.min(width, height) / 2;
  if (corners.some((corner) => corner > limit)) {
    errors.push(`each radius must be <= half the shorter side (${limit}px)`);
  }
  if (tl + tr > width || bl + br > width || tl + bl > height || tr + br > height) {
    errors.push("adjacent radii must not exceed the slot width or height");
  }
  return errors;
}
