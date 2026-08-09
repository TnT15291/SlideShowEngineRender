/**
 * Turns the engine's own failure output into something a customer can act on.
 *
 * A run that dies in `build` used to reach the customer as a Node stack trace
 * with absolute developer paths, headlined "The pipeline needs attention", and
 * the only message that survived a page reload was
 * `recipe: jmii-silk-botanical-01.json failed (exit 1)`.
 *
 * Each entry below points at a message the engine really emits — the `source`
 * note names the file — so nothing here is a guessed pattern. Anything
 * unmatched falls through to `null` and keeps today's generic wording, which is
 * the honest outcome: inventing a cause for an unknown failure would be worse
 * than saying nothing.
 *
 * The returned `code` is looked up in the web app's own string table, so the
 * customer reads it in their own language; `params` fills its placeholders.
 */
export type FailureCause = { code: string; params: Record<string, string | number> }

type Rule = {
  code: string
  /** Where in the engine this text comes from, so the pattern can be re-checked. */
  source: string
  match: RegExp
  params?: (groups: RegExpMatchArray) => Record<string, string | number>
}

const rules: Rule[] = [
  {
    code: "NOT_ENOUGH_PHOTOS",
    source: "scripts/applyStoryTemplate.mjs — assignmentPlan.unfilled",
    match: /Global photo assignment could not fill[\s\S]*?the pool has (\d+)[\s\S]*?over-drawn by (\d+)/,
    params: (groups) => ({ pool: Number(groups[1]), short: Number(groups[2]) }),
  },
  {
    code: "PHOTOS_EMPTY",
    source: "scripts/applyStoryTemplate.mjs — `${photosPath} has no photos`",
    match: /has no photos\b/,
  },
  {
    code: "MUSIC_NOT_ANALYSED",
    source: "scripts/applyStoryTemplate.mjs — music analysis not found / stale or incomplete",
    match: /music analysis (?:not found|is stale or incomplete)/,
  },
  {
    code: "FFMPEG_MISSING",
    source: "src/fileUtils.ts — FfmpegError on spawn failure",
    match: /Failed to launch ffmpeg|Is FFmpeg installed \/ on PATH/,
  },
  {
    code: "DISK_FULL",
    source: "node fs — ENOSPC surfaced by any write during render",
    match: /\bENOSPC\b|no space left on device/i,
  },
  {
    code: "OUT_OF_MEMORY",
    source: "node — heap exhaustion during a large render",
    match: /JavaScript heap out of memory|\bENOMEM\b/,
  },
  {
    code: "BRIEF_WANTS_MISSING_PHOTO",
    source: "scripts/applyStoryTemplate.mjs — brief requires unavailable/excluded photo",
    match: /brief requires unavailable\/excluded photo/,
  },
]

/** First matching rule wins; order is by how specific the pattern is. */
export function describeFailure(lines: readonly string[]): FailureCause | null {
  const text = lines.join("\n")
  for (const rule of rules) {
    const groups = text.match(rule.match)
    if (groups) return { code: rule.code, params: rule.params?.(groups) ?? {} }
  }
  return null
}

/**
 * Strip the server's own filesystem out of anything a customer might read.
 *
 * The engine logs absolute paths freely (`file:///D:/Claude/Projects/...`), and
 * those lines end up in the technical-details console, the job error, and the
 * project list. Repo-relative is enough for a bug report and tells an outsider
 * nothing about the host.
 */
export function redactEnginePaths(text: string, engineRoot: string): string {
  const variants = new Set<string>()
  for (const base of [engineRoot, engineRoot.replaceAll("\\", "/")]) {
    variants.add(base)
    variants.add(`file:///${base.replaceAll("\\", "/")}`)
    // Windows drive letters appear in both cases across Node APIs.
    variants.add(base.charAt(0).toLowerCase() + base.slice(1))
    variants.add(base.charAt(0).toUpperCase() + base.slice(1))
  }
  let result = text
  for (const variant of [...variants].sort((left, right) => right.length - left.length)) {
    if (!variant) continue
    // The trailing separator has to go too, or "at <root>/scripts/run.mjs"
    // becomes "at /scripts/run.mjs": still an absolute path to a reader,
    // rather than the repo-relative reference this is meant to produce.
    result = result.replace(new RegExp(escapeRegExp(variant) + "[/\\\\]*", "g"), "")
  }
  return result.replaceAll("file:///", "")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
