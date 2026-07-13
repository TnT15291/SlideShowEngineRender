import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import * as ort from "onnxruntime-node";

const SIZE = 640;
const clamp = (v) => Math.max(0, Math.min(1, v));
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y), x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / Math.max(1e-9, a.width * a.height + b.width * b.height - inter);
};
const nms = (rows, threshold = 0.3) => {
  const kept = [];
  for (const row of rows.sort((a, b) => b.confidence - a.confidence)) if (!kept.some((k) => iou(k.box, row.box) > threshold)) kept.push(row);
  return kept;
};

export async function createYunetDetector({ root = process.cwd(), ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", scoreThreshold = 0.5 } = {}) {
  const dir = path.resolve(root, "assets/models/yunet");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "model.json"), "utf8"));
  const modelPath = path.join(dir, manifest.file);
  const actualHash = crypto.createHash("sha256").update(fs.readFileSync(modelPath)).digest("hex");
  if (actualHash !== manifest.sha256) throw new Error(`YuNet model checksum mismatch: ${actualHash}`);
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: ["cpu"] });
  async function detect(file, dims = { w: SIZE, h: SIZE }) {
    const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:black`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 27 });
    if (r.status !== 0 || r.stdout.length < SIZE * SIZE * 3) throw new Error((r.stderr || "face frame decode failed").toString().slice(0, 200));
    const data = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) { data[i] = r.stdout[i * 3 + 2]; data[SIZE * SIZE + i] = r.stdout[i * 3 + 1]; data[2 * SIZE * SIZE + i] = r.stdout[i * 3]; }
    const out = await session.run({ input: new ort.Tensor("float32", data, [1, 3, SIZE, SIZE]) });
    const found = [];
    for (const stride of [8, 16, 32]) {
      const cls = out[`cls_${stride}`].data, obj = out[`obj_${stride}`].data, bbox = out[`bbox_${stride}`].data, kps = out[`kps_${stride}`].data;
      const cols = Math.ceil(SIZE / stride), rows = Math.ceil(SIZE / stride);
      for (let i = 0; i < rows * cols; i++) {
        const confidence = Math.sqrt(Math.max(0, cls[i] * obj[i]));
        if (confidence < scoreThreshold) continue;
        const cx = (i % cols + 0.5) * stride, cy = (Math.floor(i / cols) + 0.5) * stride;
        const box = { x: clamp((cx - bbox[i * 4] * stride) / SIZE), y: clamp((cy - bbox[i * 4 + 1] * stride) / SIZE), width: clamp((bbox[i * 4] + bbox[i * 4 + 2]) * stride / SIZE), height: clamp((bbox[i * 4 + 1] + bbox[i * 4 + 3]) * stride / SIZE) };
        const names = ["rightEye", "leftEye", "nose", "rightMouth", "leftMouth"], landmarks = {};
        for (let j = 0; j < 5; j++) landmarks[names[j]] = { x: clamp((cx + kps[i * 10 + j * 2] * stride) / SIZE), y: clamp((cy + kps[i * 10 + j * 2 + 1] * stride) / SIZE) };
        const points = Object.values(landmarks), minX = Math.min(box.x, ...points.map((p) => p.x)), minY = Math.min(box.y, ...points.map((p) => p.y));
        const maxX = Math.max(box.x + box.width, ...points.map((p) => p.x)), maxY = Math.max(box.y + box.height, ...points.map((p) => p.y));
        const padX = (maxX - minX) * 0.12, padY = (maxY - minY) * 0.3;
        const safeBox = { x: clamp(minX - padX), y: clamp(minY - padY), width: clamp(maxX - minX + padX * 2), height: clamp(maxY - minY + padY * 2) };
        found.push({ box: safeBox, confidence: +confidence.toFixed(4), landmarks });
      }
    }
    const scale = Math.min(SIZE / dims.w, SIZE / dims.h), scaledW = dims.w * scale, scaledH = dims.h * scale;
    const padX = (SIZE - scaledW) / 2, padY = (SIZE - scaledH) / 2;
    return nms(found).filter((f) => f.box.width > 0.015 && f.box.height > 0.015).map((f) => ({ ...f,
      box: { x: clamp((f.box.x * SIZE - padX) / scaledW), y: clamp((f.box.y * SIZE - padY) / scaledH), width: clamp(f.box.width * SIZE / scaledW), height: clamp(f.box.height * SIZE / scaledH) },
      landmarks: Object.fromEntries(Object.entries(f.landmarks).map(([k, p]) => [k, { x: clamp((p.x * SIZE - padX) / scaledW), y: clamp((p.y * SIZE - padY) / scaledH) }])) }));
  }
  return { detect, model: manifest };
}
