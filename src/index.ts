import path from "node:path";
import { compileTimeline } from "./compileTimeline";
import {
  ensureDir,
  FfmpegError,
  Logger,
  readJson,
  ValidationError,
} from "./fileUtils";
import { applyFaceSafeFraming } from "./faceSafeFraming";
import { normalizeTimeline } from "./normalizeTimeline";
import { preflightTimeline } from "./preflightTimeline";
import { preprocessTimelineImages } from "./preprocessImages";
import { renderFinal } from "./renderFinal";
import { renderSlides } from "./renderSlide";
import { validateTimeline } from "./validateTimeline";

// Exit codes (see docs/ENGINE-ARCHITECTURE.md):
//   0  success | 1 validation error | 2 ffmpeg error | 99 unknown
const EXIT = { OK: 0, VALIDATION: 1, FFMPEG: 2, UNKNOWN: 99 } as const;

function parseTimelineArg(argv: string[]): string {
  const idx = argv.indexOf("--timeline");
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return "timeline/timeline.json";
}

function parseJobDirArg(argv: string[], baseDir: string): string {
  const idx = argv.indexOf("--job-dir");
  return idx !== -1 && argv[idx + 1] ? path.resolve(baseDir, argv[idx + 1]) : baseDir;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");

  const baseDir = process.cwd();
  const jobDir = parseJobDirArg(argv, baseDir);
  const tempDir = path.join(jobDir, "temp");
  const logsDir = path.join(jobDir, "logs");

  ensureDir(tempDir);
  ensureDir(logsDir);

  const logger = new Logger(logsDir);
  const timelinePath = path.resolve(baseDir, parseTimelineArg(argv));

  logger.info(`Wedding Render Engine starting${dryRun ? " (dry-run)" : ""}`);
  logger.info(`Timeline: ${timelinePath}`);

  // Load + normalize + validate.
  let raw: unknown;
  try {
    raw = readJson(timelinePath);
  } catch (err) {
    throw new ValidationError(
      `Cannot read timeline: ${timelinePath}\n  ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const normalized = normalizeTimeline(raw);
  const timeline = validateTimeline(normalized, baseDir);
  logger.info(
    `Loaded ${timeline.slides.length} slides. Output: ${timeline.output.path}`
  );
  logger.info(`Quality preset: ${timeline.project.quality}`);
  const faceSafeTimeline = applyFaceSafeFraming(timeline, baseDir, logger);
  await preflightTimeline(faceSafeTimeline, baseDir, logger, dryRun);

  // Compile + render.
  const renderTimeline = await preprocessTimelineImages(
    faceSafeTimeline,
    baseDir,
    tempDir,
    logger,
    dryRun
  );
  const plan = compileTimeline(renderTimeline, baseDir, tempDir);
  await renderSlides(plan, logger, dryRun);
  await renderFinal(plan, tempDir, logger, dryRun);

  logger.info("Done.");
  return EXIT.OK;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // Best-effort console error; Logger already wrote details where it could.
    console.error(`\n[FAILED] ${msg}\n`);

    if (err instanceof ValidationError) process.exit(EXIT.VALIDATION);
    if (err instanceof FfmpegError) process.exit(EXIT.FFMPEG);
    process.exit(EXIT.UNKNOWN);
  });
