#!/usr/bin/env node
/**
 * G1.4 — reclaim disk from delivered projects, on the schedule the Privacy
 * Policy promises.
 *
 *   node scripts/purgeDeliveredProject.mjs --all                  # report only
 *   node scripts/purgeDeliveredProject.mjs --all --apply
 *   node scripts/purgeDeliveredProject.mjs --project anh-nhi --apply
 *
 * A project is ~700 MB and most of it is disposable: on a real delivered job,
 * temp/ was 418 MB and input/ 96 MB against a 309 MB output/. At that rate the
 * disk fills somewhere around the fiftieth sale, long before the business is
 * worth the hardware.
 *
 * Two windows, both taken from `apps/web/src/lib/legalContent.ts` so the code
 * and the published policy cannot drift:
 *
 *   sourceDays    (30) — the customer's uploads and every intermediate file.
 *   deliveryDays  (90) — the finished film itself, after which a customer can
 *                        no longer re-download and is expected to hold the
 *                        copy the Terms told them to keep.
 *
 * Nothing is deleted for a project that was never delivered, at any age.
 * Undelivered means the customer has not got their film yet, and no storage
 * saving is worth deleting a job that still owes someone a video.
 *
 * Reports by default; `--apply` is required to remove anything.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function arg(flag, fallback = undefined) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
}
const has = (flag) => process.argv.includes(flag);

// Read out of the published policy rather than redeclared here. If someone
// changes the promise on the website, this script changes with it.
const legal = fs.readFileSync(path.join(root, "apps", "web", "src", "lib", "legalContent.ts"), "utf8");
function policyDays(name, fallback) {
  const match = legal.match(new RegExp(`${name}:\\s*(\\d+)`));
  return match ? Number(match[1]) : fallback;
}

const sourceDays = Number(arg("--source-days", String(policyDays("sourceDays", 30))));
const deliveryDays = Number(arg("--delivery-days", String(policyDays("deliveryDays", 90))));
const apply = has("--apply");
const projectArg = arg("--project");

if (!projectArg && !has("--all")) {
  console.error("Usage: node scripts/purgeDeliveredProject.mjs (--project <id> | --all) [--apply]");
  console.error(`  Source files are removed ${sourceDays} days after delivery, the film after ${deliveryDays}.`);
  console.error("  Without --apply this only reports what it would delete.");
  process.exit(2);
}
if (!Number.isInteger(sourceDays) || !Number.isInteger(deliveryDays) || sourceDays < 1 || deliveryDays < sourceDays) {
  console.error(`Invalid windows: --source-days ${sourceDays}, --delivery-days ${deliveryDays} (delivery must be >= source).`);
  process.exit(2);
}

const projectsDir = path.join(root, "projects");

/** Bytes on disk under `target`, or 0 if it is not there. */
function sizeOf(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      const info = fs.statSync(current);
      if (info.isFile()) { total += info.size; continue; }
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) stack.push(path.join(current, entry.name));
  }
  return total;
}

function human(bytes) {
  if (bytes === 0) return "0 KB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * When this project's film was handed over, or null if it never was.
 *
 * The delivery receipt is the authority. Its absence is the whole reason this
 * script is safe to run with --all: an abandoned half-finished project has no
 * receipt, so it is never touched, however old it is.
 */
function deliveredAt(projectDir) {
  const receipt = path.join(projectDir, "output", "deliver", "approval-receipt.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(receipt, "utf8"));
    const stamp = Date.parse(parsed.generatedAt);
    if (Number.isFinite(stamp)) return stamp;
  } catch { /* fall through to the file's own timestamp */ }
  // A receipt that exists but has no readable date still proves delivery
  // happened; its mtime is a fair stand-in.
  try { return fs.statSync(receipt).mtimeMs; } catch { return null; }
}

const ids = projectArg
  ? [projectArg]
  : fs.readdirSync(projectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

// Uploads and intermediates. `analysis/`, `timeline/`, `logs/` and the
// manifests stay: together they are a few MB and they are what makes a later
// "can you re-cut this?" answerable at all.
const sourceTargets = ["input", "music", "temp", path.join("output", "final.mp4")];
// The delivered package, plus whatever else is left under output/.
const deliveryTargets = ["output"];

let totalReclaimed = 0;
let acted = 0;
let skipped = 0;

for (const id of ids) {
  const projectDir = path.join(projectsDir, id);
  if (!fs.existsSync(path.join(projectDir, "project.json"))) continue;

  const delivered = deliveredAt(projectDir);
  if (delivered === null) {
    skipped += 1;
    if (projectArg) console.log(`${id}: not delivered yet — nothing is ever purged from an undelivered project.`);
    continue;
  }

  const ageDays = (Date.now() - delivered) / 86_400_000;
  const stage = ageDays >= deliveryDays ? "delivery" : ageDays >= sourceDays ? "source" : null;
  if (!stage) {
    skipped += 1;
    if (projectArg) {
      console.log(`${id}: delivered ${ageDays.toFixed(0)} day(s) ago — source files are removed at ${sourceDays}.`);
    }
    continue;
  }

  const targets = stage === "delivery" ? [...sourceTargets, ...deliveryTargets] : sourceTargets;
  const present = targets
    .map((relative) => ({ relative, absolute: path.join(projectDir, relative) }))
    .filter((entry) => fs.existsSync(entry.absolute))
    .map((entry) => ({ ...entry, bytes: sizeOf(entry.absolute) }));

  if (!present.length) { skipped += 1; continue; }

  const bytes = present.reduce((sum, entry) => sum + entry.bytes, 0);
  totalReclaimed += bytes;
  acted += 1;

  console.log(`${id} — delivered ${ageDays.toFixed(0)} day(s) ago, ${stage === "delivery" ? "past both windows" : "past the source window"}`);
  for (const entry of present) {
    console.log(`  ${apply ? "removing" : "would remove"} ${entry.relative.replaceAll("\\", "/")} (${human(entry.bytes)})`);
    if (apply) fs.rmSync(entry.absolute, { recursive: true, force: true });
  }
}

console.log("");
console.log(`${acted} project(s) ${apply ? "purged" : "would be purged"}, ${skipped} left alone, ${human(totalReclaimed)} ${apply ? "reclaimed" : "reclaimable"}.`);
if (!apply && acted > 0) console.log("Re-run with --apply to delete.");
if (apply && acted > 0) {
  console.log("");
  console.log("The Privacy Policy promises this. Keep it on a schedule, not on memory.");
}
