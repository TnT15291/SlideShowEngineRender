import fs from "node:fs";

// Read an image's intrinsic pixel dimensions straight from its file header,
// with zero dependencies (no ffprobe, no image library). We only need width vs
// height to decide framing (landscape crop vs portrait blur-background), so a
// small header parser for the two formats we ship (JPEG, PNG) is enough.

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Best-effort image size. Returns undefined if the format isn't recognized or
 * the header is malformed — callers treat "unknown" as landscape (safe crop),
 * so a parse miss never crashes the render.
 */
export function readImageSize(filePath: string): ImageSize | undefined {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return undefined;
  }

  return readPng(buf) ?? readJpeg(buf);
}

// PNG: 8-byte signature, then IHDR chunk whose width/height are the first two
// big-endian uint32s of its data (bytes 16..24 from file start).
function readPng(buf: Buffer): ImageSize | undefined {
  const SIG = "\x89PNG\r\n\x1a\n";
  if (buf.length < 24) return undefined;
  if (buf.toString("latin1", 0, 8) !== SIG) return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// JPEG: walk the segment markers until a Start-Of-Frame (SOFn), whose payload
// holds height then width as big-endian uint16s. Skip other markers by length.
function readJpeg(buf: Buffer): ImageSize | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined; // SOI

  let offset = 2;
  while (offset + 9 < buf.length) {
    // Markers begin with 0xFF; padding bytes (0xFF) are skipped.
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    offset += 2;

    // Standalone markers (no length): RSTn, SOI, EOI, TEM.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    const segLen = buf.readUInt16BE(offset);
    // SOF0..SOF15, excluding DHT(C4), JPG(C8), DAC(CC) which aren't frame headers.
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSof) {
      // payload: [precision(1)][height(2)][width(2)]...
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      return { width, height };
    }

    offset += segLen; // segLen includes its own 2 length bytes
  }

  return undefined;
}

/** A portrait image is taller than it is wide. Unknown sizes are not portrait. */
export function isPortrait(size: ImageSize | undefined): boolean {
  return size !== undefined && size.height > size.width;
}

/**
 * Fraction of the image lost when cover-filling a frame (0 = aspects match,
 * 0.44 = a 2:3 portrait cover-cropped to 16:9). Works for any frame aspect, so
 * portrait 9:16 projects judge landscape photos the same way 16:9 projects
 * judge portrait ones. Unknown sizes report 0 (safe crop, never reroutes).
 */
export function coverCropLoss(
  size: ImageSize | undefined,
  frameWidth: number,
  frameHeight: number
): number {
  if (!size || size.width <= 0 || size.height <= 0) return 0;
  const imageAspect = size.width / size.height;
  const frameAspect = frameWidth / frameHeight;
  return 1 - Math.min(imageAspect, frameAspect) / Math.max(imageAspect, frameAspect);
}
