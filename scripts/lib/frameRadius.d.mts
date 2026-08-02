export const MAX_FRAME_RADIUS: number;

export function radiusCorners(
  radius: unknown,
): [number, number, number, number] | null;

export function frameRadiusErrors(
  radius: unknown,
  width?: number,
  height?: number,
): string[];
