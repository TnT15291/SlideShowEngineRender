import type { QualityPreset } from "./types";

export interface QualityProfile {
  name: QualityPreset;
  x264Preset: "ultrafast" | "veryfast" | "faster" | "fast" | "medium" | "slow";
  crf: number;
  audioBitrate: string;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityProfile> = {
  draft: {
    name: "draft",
    x264Preset: "veryfast",
    crf: 28,
    audioBitrate: "128k",
  },
  share: {
    name: "share",
    x264Preset: "medium",
    crf: 20,
    audioBitrate: "192k",
  },
  high: {
    name: "high",
    x264Preset: "slow",
    crf: 18,
    audioBitrate: "256k",
  },
  master: {
    name: "master",
    x264Preset: "slow",
    crf: 16,
    audioBitrate: "320k",
  },
};

export const DEFAULT_QUALITY: QualityPreset = "share";

export function resolveQualityProfile(
  preset: QualityPreset | undefined
): QualityProfile {
  return QUALITY_PRESETS[preset ?? DEFAULT_QUALITY];
}

export function videoEncodeArgs(profile: QualityProfile, fps: number): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    profile.x264Preset,
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    "-movflags",
    "+faststart",
  ];
}

export function audioEncodeArgs(profile: QualityProfile): string[] {
  return ["-c:a", "aac", "-b:a", profile.audioBitrate];
}
