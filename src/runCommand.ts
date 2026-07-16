import { spawn } from "node:child_process";
import { FfmpegError, Logger } from "./fileUtils";

export function runCommand(
  bin: string,
  args: string[],
  label: string,
  logger: Logger,
  dryRun: boolean
): Promise<void> {
  logger.command(bin, args);
  if (dryRun) {
    logger.info(`[dry-run] ${label}: command logged, not executed`);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => reject(new FfmpegError(`Failed to launch ${bin} for ${label}: ${err.message}`)));
    child.on("close", (code) => {
      logger.ffmpegStderr(label, stderr);
      if (code === 0) return resolve();
      const tail = stderr.trim().split("\n").slice(-12).join("\n");
      reject(new FfmpegError(`${bin} exited with code ${code} for ${label}.\n${tail}`));
    });
  });
}
