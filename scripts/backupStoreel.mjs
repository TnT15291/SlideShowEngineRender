#!/usr/bin/env node
/**
 * G2.4 — back up everything that cannot be regenerated.
 *
 *   node scripts/backupStoreel.mjs --to <destination> [--full] [--keep 14]
 *
 * Two tiers, because they have wildly different sizes and equally different
 * consequences:
 *
 *   accounts (always)  server/data/ — users, sessions, password-reset tokens,
 *                      incidents.sqlite. A few hundred kilobytes. Losing it
 *                      means every paying customer loses their account and
 *                      their credits, and there is no way to prove what they
 *                      bought. This is copied every run.
 *
 *   projects (--full)  projects/ — the customers' own wedding photos, at
 *                      ~700 MB each. Losing these is the loss you cannot
 *                      apologise for, but copying 41 GB every night to the
 *                      same disk achieves nothing. Run --full to a different
 *                      machine or a mounted remote.
 *
 * Restore with scripts/restoreStoreel.mjs. A backup nobody has restored is not
 * a backup — the plan says so, and `--verify` below is why this script can be
 * held to it: every file is hashed on the way out and the manifest is what
 * restore checks against.
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

const destinationArg = arg("--to");
if (!destinationArg) {
  console.error("Usage: node scripts/backupStoreel.mjs --to <destination> [--full] [--keep <count>]");
  console.error("  --to     directory to write the backup into (use a different disk or machine)");
  console.error("  --full   also copy projects/ — the customers' photos and films");
  console.error("  --keep   how many previous backups to retain in --to (default 14)");
  process.exit(2);
}

const full = has("--full");
const keep = Number(arg("--keep", "14"));
if (!Number.isInteger(keep) || keep < 1) {
  console.error(`--keep must be a positive integer, got "${arg("--keep")}"`);
  process.exit(2);
}

const destinationRoot = path.resolve(root, destinationArg);
// A backup written inside the thing it is backing up survives exactly none of
// the failures a backup exists for, and on --full it would try to copy itself.
if (destinationRoot === root || destinationRoot.startsWith(`${root}${path.sep}`)) {
  console.error(`Refusing to back up into the engine directory itself: ${destinationRoot}`);
  console.error("Point --to at another disk, a mounted network share, or an external drive.");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = path.join(destinationRoot, `storeel-${stamp}`);

/** Everything under `source`, as paths relative to it. Directories are not listed. */
function walk(source, prefix = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(source, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(source, entry.name), relative));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Copy one tree, recording a hash per file.
 *
 * Hashes are not decoration: they are the only way `restoreStoreel.mjs
 * --verify` can tell a complete backup from one that was interrupted halfway
 * through, which is precisely the backup you discover at the worst moment.
 */
function copyTree(name, source, destination) {
  const files = walk(source);
  if (!files.length) return { name, files: [], bytes: 0 };
  let bytes = 0;
  const records = [];
  for (const relative of files) {
    const from = path.join(source, relative);
    const to = path.join(destination, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    const size = fs.statSync(to).size;
    bytes += size;
    records.push({ path: relative, size, sha256: sha256(to) });
  }
  return { name, files: records, bytes };
}

function human(bytes) {
  if (bytes === 0) return "0 KB";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const started = Date.now();
fs.mkdirSync(target, { recursive: true });

const trees = [{ name: "server/data", source: path.join(root, "server", "data") }];
if (full) trees.push({ name: "projects", source: path.join(root, "projects") });

const results = [];
for (const tree of trees) {
  process.stdout.write(`Copying ${tree.name}… `);
  const result = copyTree(tree.name, tree.source, path.join(target, tree.name));
  results.push(result);
  console.log(`${result.files.length} file(s), ${human(result.bytes)}`);
}

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  engineRoot: root,
  full,
  trees: results,
  totalBytes: results.reduce((sum, tree) => sum + tree.bytes, 0),
  totalFiles: results.reduce((sum, tree) => sum + tree.files.length, 0),
};
// Written last, and only after every copy succeeded. Its presence is what
// marks a backup complete; a run killed halfway leaves a directory with no
// manifest, and restore refuses it rather than half-restoring an account file.
fs.writeFileSync(path.join(target, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

// Retention. Only directories this script made — matched by the manifest
// inside them, not by name alone, so a stray folder in the destination is
// never deleted.
const siblings = fs.readdirSync(destinationRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("storeel-"))
  .map((entry) => path.join(destinationRoot, entry.name))
  .filter((directory) => fs.existsSync(path.join(directory, "backup-manifest.json")))
  .sort();
const stale = siblings.slice(0, Math.max(0, siblings.length - keep));
for (const directory of stale) {
  fs.rmSync(directory, { recursive: true, force: true });
  console.log(`Pruned ${path.basename(directory)}`);
}

console.log("");
console.log(`Backup complete: ${target}`);
console.log(`  ${manifest.totalFiles} file(s), ${human(manifest.totalBytes)}, ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (!full) {
  console.log("  Accounts only. Add --full to include projects/ (the customers' photos).");
}
console.log("");
console.log("Not yet a backup. Prove it restores:");
console.log(`  node scripts/restoreStoreel.mjs --from "${target}" --verify`);
