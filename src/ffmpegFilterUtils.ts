/** "#rrggbb" -> "0xrrggbb" (FFmpeg syntax); named colors pass through. */
export function cssColor(color: string): string {
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

/** Quote a path for use inside an FFmpeg filtergraph, including Windows drives. */
export function quoteFilterPath(path: string): string {
  return `'${path.replace(/:/g, "\\:")}'`;
}
