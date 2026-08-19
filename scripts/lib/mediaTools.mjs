import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

export function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  try {
    const packageDir = path.dirname(require.resolve("ffmpeg-static"));
    const bundledFile = path.join(packageDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    if (fs.existsSync(bundledFile)) return bundledFile;
    const loaded = require("ffmpeg-static");
    const bundled = typeof loaded === "string" ? loaded : loaded?.default;
    if (typeof bundled === "string" && fs.existsSync(bundled)) return bundled;
  } catch {
    // Fall back to PATH below.
  }
  return "ffmpeg";
}

export function run(bin, args, { capture = false, allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    } else {
      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) return resolve({ code, stdout, stderr });
      reject(new Error(`${path.basename(bin)} exited with code ${code}${stderr ? `\n${stderr.trim()}` : ""}`));
    });
  });
}

export async function probeMedia(file, ffmpeg = resolveFfmpeg()) {
  const result = await run(ffmpeg, ["-hide_banner", "-i", file], {
    capture: true,
    allowFailure: true,
  });
  const text = result.stderr;
  const durationMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const videoLine = text.split(/\r?\n/).find((line) => /Video:/.test(line)) || "";
  const sizeMatch = videoLine.match(/(?:^|\s)(\d{2,5})x(\d{2,5})(?:[\s,]|$)/);
  const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps\b/);
  const audioLine = text.split(/\r?\n/).find((line) => /Audio:/.test(line)) || "";
  if (!durationMatch) throw new Error(`Cannot read media duration: ${file}`);
  const duration =
    Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
  return {
    duration,
    width: sizeMatch ? Number(sizeMatch[1]) : undefined,
    height: sizeMatch ? Number(sizeMatch[2]) : undefined,
    fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
    hasAudio: Boolean(audioLine),
    pixelFormat: /\byuv420p\b/.test(videoLine) ? "yuv420p" : undefined,
  };
}

export function ensureInside(baseDir, target, label = "path") {
  const base = path.resolve(baseDir);
  const absolute = path.resolve(target);
  const relative = path.relative(base, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes project directory: ${absolute}`);
  }
  return absolute;
}

export function parseTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  const parts = raw.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function wavDuration(buffer) {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Expected a RIFF/WAVE buffer");
  }
  let offset = 12;
  let byteRate;
  let dataSize;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) byteRate = buffer.readUInt32LE(offset + 8 + 8);
    if (id === "data") {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || dataSize == null) throw new Error("WAV is missing fmt or data chunk");
  return dataSize / byteRate;
}

export function silentWav(duration, sampleRate = 48000) {
  const samples = Math.max(0, Math.round(duration * sampleRate));
  const dataSize = samples * 2;
  const out = Buffer.alloc(44 + dataSize);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataSize, 40);
  return out;
}
