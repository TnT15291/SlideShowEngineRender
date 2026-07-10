import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Optional bundled ffmpeg (devDependency `ffmpeg-static`): lets the engine run
// with zero external setup. Resolved lazily and tolerantly — the package may
// be absent in production installs.
const requireCjs = createRequire(import.meta.url);
let ffmpegStaticPath: string | undefined;
try {
  const p = requireCjs("ffmpeg-static") as string | null;
  if (p && fs.existsSync(p)) ffmpegStaticPath = p;
} catch {
  // not installed — fall through to PATH lookup
}

// ---- Typed errors so the CLI can map them to exit codes ----

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FfmpegError";
  }
}

// ---- Filesystem helpers ----

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function readJson(p: string): unknown {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

/** FFmpeg wants forward slashes in concat lists and filter paths, even on Windows. */
export function toFfmpegPath(p: string): string {
  return p.replace(/\\/g, "/");
}

// ---- Logging: commands.log (every ffmpeg invocation) + render.log (stderr/events) ----

export class Logger {
  private commandsLog: string;
  private renderLog: string;

  constructor(logsDir: string) {
    ensureDir(logsDir);
    this.commandsLog = path.join(logsDir, "commands.log");
    this.renderLog = path.join(logsDir, "render.log");
    // Fresh logs per run.
    fs.writeFileSync(this.commandsLog, "");
    fs.writeFileSync(this.renderLog, "");
  }

  private stamp(): string {
    return new Date().toISOString();
  }

  info(msg: string): void {
    const line = `[${this.stamp()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(this.renderLog, line + "\n");
  }

  error(msg: string): void {
    const line = `[${this.stamp()}] [ERROR] ${msg}`;
    console.error(line);
    fs.appendFileSync(this.renderLog, line + "\n");
  }

  command(bin: string, args: string[]): void {
    const line = `[${this.stamp()}] ${bin} ${args.map(quoteArg).join(" ")}`;
    fs.appendFileSync(this.commandsLog, line + "\n");
  }

  ffmpegStderr(label: string, stderr: string): void {
    fs.appendFileSync(
      this.renderLog,
      `\n----- ffmpeg stderr: ${label} -----\n${stderr}\n`
    );
  }
}

function quoteArg(a: string): string {
  return /\s/.test(a) ? `"${a}"` : a;
}

// ---- FFmpeg process runner ----

/** Resolve ffmpeg: FFMPEG_PATH env override > bundled ffmpeg-static > PATH. */
export function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || ffmpegStaticPath || "ffmpeg";
}

/**
 * Media duration in seconds, parsed from `ffmpeg -i` metadata output (no
 * decode, near-instant). Returns undefined when the file can't be read.
 */
export function probeDurationSeconds(file: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegBin(), ["-hide_banner", "-i", file], {
      windowsHide: true,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", () => resolve(undefined));
    child.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return resolve(undefined);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
  });
}

/**
 * Run ffmpeg with the given args. Logs the command, captures stderr,
 * resolves on exit 0, rejects with FfmpegError (including stderr tail) otherwise.
 *
 * In `dryRun` mode the command is logged (to commands.log) but not executed, so
 * the full pipeline can be inspected without ffmpeg installed.
 */
export function runFfmpeg(
  args: string[],
  label: string,
  logger: Logger,
  dryRun = false
): Promise<void> {
  const bin = ffmpegBin();
  logger.command(bin, args);

  if (dryRun) {
    logger.info(`[dry-run] ${label}: command logged, not executed`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      reject(
        new FfmpegError(
          `Failed to launch ffmpeg for ${label}: ${err.message}. ` +
            `Is FFmpeg installed / on PATH, or FFMPEG_PATH set?`
        )
      );
    });

    child.on("close", (code) => {
      logger.ffmpegStderr(label, stderr);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.trim().split("\n").slice(-8).join("\n");
        reject(
          new FfmpegError(
            `ffmpeg exited with code ${code} for ${label}.\n${tail}`
          )
        );
      }
    });
  });
}
