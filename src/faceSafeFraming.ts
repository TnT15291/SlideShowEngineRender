import path from "node:path";
import { Logger } from "./fileUtils";
import { coverCropLoss, readImageSize } from "./imageSize";
import type { SceneLayer, Timeline } from "./types";

const DEFAULT_MAX_CROP_LOSS = 0.18;

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
      if (layer.type !== "image") return layer;
      // The motion renderer uses a cover-sized zoompan source regardless of the
      // declared fit. Judge the geometry that will actually be rendered, not
      // only `fit`, or a portrait `contain + zoom_in` can still lose both faces.
      const hasMotion = layer.motion !== undefined && layer.motion !== "none";
      if (layer.fit !== "cover" && !hasMotion) return layer;

      const size = readImageSize(path.resolve(baseDir, layer.path));
      const loss = coverCropLoss(size, layer.width, layer.height);
      if (loss <= maxCropLoss) return layer;

      changed++;
      logger.info(
        `Face-safe framing: slide ${slide.id} layers[${li}] ` +
          `${hasMotion ? `${layer.fit} + ${layer.motion}` : "cover"} -> contain + no motion ` +
          `(${Math.round(loss * 100)}% crop risk, ${layer.path})`
      );
      return { ...layer, fit: "contain", motion: "none", motionStrength: undefined };
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
