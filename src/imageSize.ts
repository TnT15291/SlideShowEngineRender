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
//
// The SOF dimensions are the STORED ones. A camera that shot in portrait usually
// stores the frame landscape and adds an EXIF Orientation tag telling the viewer
// to rotate it — and ffmpeg honours that tag when it decodes (autorotate is on by
// default). So the stored size is not the size the renderer will actually receive.
// Reporting it would tell the engine "landscape" about a photo ffmpeg then hands
// it as portrait: the crop and zoom maths are computed for one aspect and applied
// to the other. We therefore return the DISPLAY size, which is what every other
// stage in the pipeline sees.
function readJpeg(buf: Buffer): ImageSize | undefined {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return undefined; // SOI

  let orientation = 1; // APP1 precedes SOF in the file, so this is set by the time we need it
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

    if (marker === 0xe1) {
      orientation = readExifOrientation(buf, offset + 2, segLen - 2) ?? orientation;
    }

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
      // 5..8 are the quarter-turns (with or without a mirror); they transpose the frame.
      const turned = orientation >= 5 && orientation <= 8;
      return turned ? { width: height, height: width } : { width, height };
    }

    offset += segLen; // segLen includes its own 2 length bytes
  }

  return undefined;
}

/**
 * EXIF Orientation (TIFF tag 0x0112) out of an APP1 segment, or undefined if the
 * segment is not EXIF / is malformed. 1 = as stored; 6 and 8 are the common
 * quarter-turns a phone or DSLR writes when you rotate the body.
 */
function readExifOrientation(buf: Buffer, start: number, length: number): number | undefined {
  const end = Math.min(start + length, buf.length);
  if (end - start < 14) return undefined;
  if (buf.toString("latin1", start, start + 6) !== "Exif\0\0") return undefined;

  const tiff = start + 6;
  const le = buf.toString("latin1", tiff, tiff + 2) === "II";
  const u16 = (at: number) => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at: number) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));

  if (u16(tiff + 2) !== 0x002a) return undefined; // TIFF magic
  const ifd0 = tiff + u32(tiff + 4);
  if (ifd0 + 2 > end) return undefined;

  const count = u16(ifd0);
  for (let i = 0; i < count; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8); // SHORT: value sits in the first 2 bytes of the field
      return value >= 1 && value <= 8 ? value : undefined;
    }
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
