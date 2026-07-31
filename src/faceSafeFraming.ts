import path from "node:path";
import { Logger } from "./fileUtils";
import { faceCropLoss, readImageSize } from "./imageSize";
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

      // The whole point of this pass is protecting a face from an aspect-ratio
      // crop. Photo analysis (analyzePhotos.mjs) only sets faceBox when it found
      // a face or skin region; no faceBox means no face was detected in this
      // image, so there is nothing here for the crop-loss threshold to protect.
      if (!layer.faceBox) return layer;

      const size = readImageSize(path.resolve(baseDir, layer.path));
      // What actually endangers this face is where the cover-crop window
      // lands relative to faceBox, not the generic image-vs-frame aspect
      // mismatch — a face dead-center in a heavily-cropped image is fine,
      // and a face near the edge of a barely-cropped one is not.
      const loss = faceCropLoss(layer.faceBox, size, layer.width, layer.height, layer.focusX, layer.focusY);
      if (loss <= maxCropLoss) return layer;

      changed++;
      logger.info(
        `Face-safe framing: slide ${slide.id} layers[${li}] ` +
          `${hasMotion ? `${layer.fit} + ${layer.motion}` : "cover"} -> contain + no motion ` +
          `(${Math.round(loss * 100)}% of the detected face would be cropped, ${layer.path})`
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
