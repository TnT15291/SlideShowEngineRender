import path from "node:path";
import { Logger } from "./fileUtils";
import { coverCropLoss, readImageSize } from "./imageSize";
import type { SceneLayer, Timeline } from "./types";

const DEFAULT_MAX_CROP_LOSS = 0.18;
const BACKGROUND_AREA_RATIO = 0.9;

export function applyFaceSafeFraming(
  timeline: Timeline,
  baseDir: string,
  logger: Logger
): Timeline {
  const maxCropLoss = parseMaxCropLoss();
  if (maxCropLoss <= 0) {
    logger.info("Face-safe framing disabled (FACE_SAFE_MAX_CROP_LOSS <= 0)");
    return timeline;
  }

  let changed = 0;
  const slides = timeline.slides.map((slide) => {
    if (slide.effect !== "layer_scene" || !slide.layers) return slide;

    const layers = slide.layers.map((layer, li): SceneLayer => {
      if (layer.type !== "image" || layer.fit !== "cover") return layer;
      // A supplied focal point (from photo analysis) already keeps the subject
      // inside a cover crop, so keep cover and let it crop toward the face
      // instead of falling back to a letterboxed contain.
      if (layer.focusX !== undefined || layer.focusY !== undefined) return layer;
      if (isLikelyBackground(layer, timeline.project.width, timeline.project.height)) {
        return layer;
      }

      const size = readImageSize(path.resolve(baseDir, layer.path));
      const loss = coverCropLoss(size, layer.width, layer.height);
      if (loss <= maxCropLoss) return layer;

      changed++;
      logger.info(
        `Face-safe framing: slide ${slide.id} layers[${li}] ` +
          `cover -> contain (${Math.round(loss * 100)}% crop risk, ${layer.path})`
      );
      return { ...layer, fit: "contain" };
    });

    return layers === slide.layers ? slide : { ...slide, layers };
  });

  if (changed > 0) {
    logger.info(`Face-safe framing adjusted ${changed} layer image(s)`);
    return { ...timeline, slides };
  }

  logger.info("Face-safe framing: no risky layer cover crops found");
  return timeline;
}

function parseMaxCropLoss(): number {
  const raw = process.env.FACE_SAFE_MAX_CROP_LOSS;
  if (!raw) return DEFAULT_MAX_CROP_LOSS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_MAX_CROP_LOSS;
}

function isLikelyBackground(
  layer: SceneLayer,
  frameWidth: number,
  frameHeight: number
): boolean {
  const frameArea = frameWidth * frameHeight;
  const layerArea = layer.width * layer.height;
  return (
    layer.x <= 0 &&
    layer.y <= 0 &&
    layer.width >= frameWidth &&
    layer.height >= frameHeight &&
    layerArea / frameArea >= BACKGROUND_AREA_RATIO
  );
}
