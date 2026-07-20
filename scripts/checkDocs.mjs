import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const npmScripts = new Set(Object.keys(packageJson.scripts || {}));

// These names only occur in passages that explicitly document removed legacy entrypoints.
const historicalScripts = new Set(["buildClip.mjs", "runPremiumJob.mjs", "generateStoryClip.mjs"]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(root).filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
const sourceBasenames = new Set(sourceFiles.map((file) => path.basename(file)));
const docs = walk(docsDir).filter((file) => file.endsWith(".md"));
const errors = [];

for (const file of docs) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).replace(/\\/g, "/");

  for (const match of text.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
    if (!npmScripts.has(match[1])) errors.push(`${rel}: unknown npm script "${match[1]}"`);
  }

  for (const match of text.matchAll(/(?:scripts\/)?([a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:mjs|cjs|ts|tsx))/g)) {
    const name = match[1];
    if (text.slice(Math.max(0, match.index - 2), match.index) === "*.") continue;
    if (!sourceBasenames.has(name) && !historicalScripts.has(name)) {
      errors.push(`${rel}: missing source file "${name}"`);
    }
  }

  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0].trim();
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const decoded = decodeURIComponent(target.replace(/^<|>$/g, ""));
    if (!fs.existsSync(path.resolve(path.dirname(file), decoded))) {
      errors.push(`${rel}: broken local link "${target}"`);
    }
  }
}

if (errors.length) {
  console.error(`Documentation check failed (${errors.length}):\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  process.exit(1);
}

console.log(`Documentation check passed (${docs.length} Markdown files).`);
