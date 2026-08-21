import { spawnSync } from "node:child_process";

/** Display dimensions — i.e. what ffmpeg actually decodes.
 *
 * ffprobe reports the STORED size; a camera held sideways stores the frame
 * landscape and records an EXIF rotation instead. ffmpeg honours that rotation on
 * decode (autorotate defaults on), so a 7008x4672 file with rotation 90 reaches
 * every later stage as a 4672x7008 PORTRAIT frame. Reporting the stored size marks
 * such a photo `landscape`: it gets landscape effects, fills landscape slots, and
 * has its face-safe crop computed against an aspect it does not have — while
 * focusX/focusY, which come from an ffmpeg-decoded (already rotated) frame, are
 * measured in the OTHER coordinate system. Swap here and the whole pipeline agrees.
 *
 * Returns `{ w, h }` or `{ err }`; never a zero-shaped record, because w=h=0 makes
 * every photograph "landscape" and every caller downstream believes it.
 */
export function probeDisplaySize(file, ffprobe) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file], { encoding: "utf8" });
  if (r.error) return { err: `ffprobe not runnable (${ffprobe}): ${r.error.message}` };
  if (r.status !== 0) return { err: `ffprobe exit ${r.status}: ${(r.stderr || "").trim().slice(0, 160)}` };
  const [w, h] = (r.stdout || "").trim().split("x").map(Number);
  if (!w || !h) return { err: `ffprobe gave no dimensions (stdout: ${JSON.stringify((r.stdout || "").trim())})` };

  const rot = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream_tags=Orientation:side_data=rotation",
    "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const deg = Math.abs(Number((rot.stdout || "").trim().split(/\s+/)[0]) || 0) % 180;
  return deg === 90 ? { w: h, h: w } : { w, h };
}

/** The ffprobe that sits beside the configured ffmpeg — they must be the same build. */
export function resolveFfprobe(ffmpeg = process.env.FFMPEG_PATH || "ffmpeg") {
  return ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, extension) => `ffprobe${extension || ""}`);
}
