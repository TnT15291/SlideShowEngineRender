#!/usr/bin/env node
/**
 * G2.4 — the other half. Restoring is the part that is never rehearsed, so it
 * is a first-class script with a dry mode you can run on a normal Tuesday.
 *
 *   node scripts/restoreStoreel.mjs --from <backup> --verify
 *   node scripts/restoreStoreel.mjs --from <backup> --into <empty dir>
 *   node scripts/restoreStoreel.mjs --from <backup> --into . --overwrite
 *
 * --verify    re-hash every file in the backup against its manifest and report.
 *             Writes nothing. This is the one to put on a schedule.
 * --into      write the restored tree here. Refuses a non-empty target unless
 *             --overwrite is given, because the realistic mistake is restoring
 *             a week-old account file over a live one.
 *
 * The plan's acceptance test is "restore onto a blank machine". That is:
 *   node scripts/restoreStoreel.mjs --from /mnt/backup/storeel-<stamp> --into .
 */
import { createHash } from "node:crypto";
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

const fromArg = arg("--from");
if (!fromArg) {
  console.error("Usage: node scripts/restoreStoreel.mjs --from <backup> [--verify | --into <dir> [--overwrite]]");
  process.exit(2);
}

const source = path.resolve(root, fromArg);
const manifestPath = path.join(source, "backup-manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`No backup-manifest.json in ${source}`);
  // The manifest is written last, so its absence has a specific meaning worth
  // saying out loud rather than leaving as "file not found".
  console.error("That directory is either not a StoReel backup, or a run that was interrupted before it finished.");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.version !== 1) {
  console.error(`Unsupported backup version ${manifest.version}`);
  process.exit(1);
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function human(bytes) {
  if (bytes === 0) return "0 KB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

console.log(`Backup taken ${manifest.createdAt}`);
console.log(`  ${manifest.totalFiles} file(s), ${human(manifest.totalBytes)}${manifest.full ? "" : ", accounts only (no projects/)"}`);
console.log("");

// ── Verify ───────────────────────────────────────────────────────────────────
const problems = [];
for (const tree of manifest.trees) {
  for (const record of tree.files) {
    const file = path.join(source, tree.name, record.path);
    if (!fs.existsSync(file)) { problems.push(`missing: ${tree.name}/${record.path}`); continue; }
    const size = fs.statSync(file).size;
    if (size !== record.size) { problems.push(`wrong size: ${tree.name}/${record.path} (${size} ≠ ${record.size})`); continue; }
    if (sha256(file) !== record.sha256) problems.push(`corrupt: ${tree.name}/${record.path}`);
  }
}

if (problems.length) {
  console.error(`${problems.length} problem(s) in this backup:`);
  for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
  if (problems.length > 20) console.error(`  …and ${problems.length - 20} more`);
  console.error("");
  console.error("Do not rely on this backup. Take a fresh one and find out why this one is damaged.");
  process.exit(1);
}
console.log(`Verified: all ${manifest.totalFiles} file(s) match the manifest.`);

if (has("--verify") || !has("--into")) {
  if (!has("--verify")) console.log("\nNothing written (no --into given). Add --into <dir> to actually restore.");
  process.exit(0);
}

// ── Restore ──────────────────────────────────────────────────────────────────
const target = path.resolve(root, arg("--into"));
const overwrite = has("--overwrite");

for (const tree of manifest.trees) {
  const destination = path.join(target, tree.name);
  // Checked per tree, not once for the target: restoring server/data onto a
  // machine that already has projects/ is normal, and should not be blocked by
  // the presence of an unrelated directory.
  const occupied = fs.existsSync(destination) && fs.readdirSync(destination).length > 0;
  if (occupied && !overwrite) {
    console.error(`\n${destination} already has files in it.`);
    console.error("Restoring over live account data is the mistake this guard exists for.");
    console.error("Restore into an empty directory instead, or pass --overwrite if you are certain.");
    process.exit(1);
  }
}

let written = 0;
for (const tree of manifest.trees) {
  for (const record of tree.files) {
    const from = path.join(source, tree.name, record.path);
    const to = path.join(target, tree.name, record.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    written += 1;
  }
}

console.log(`\nRestored ${written} file(s) into ${target}`);
console.log("");
console.log("Next: start the API and sign in as a real customer account.");
console.log("A restore that has not been logged into has not been tested.");
