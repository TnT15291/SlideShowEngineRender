import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { callDeepSeekJSON, hasKey, provenance, str, oneOf, filterVocab } from "./lib/deepseek.mjs";

const project = loadProject(arg("--project"));
const promptRel = project.manifest.promptFile || "prompt.txt";
const prompt = fs.readFileSync(project.abs(promptRel), "utf8").trim();
const modes = new Set(["keep_all", "best_only", "hybrid"]);
const categories = new Set(["ceremony", "family", "friends", "decoration", "couple", "guests", "preparation", "reception"]);

function deterministicPolicy() {
  if (/keep every|keep all|use all|không bỏ|không loại|giữ (tất cả|toàn bộ|mọi)/i.test(prompt)) return { mode: "keep_all" };
  if (/best (photos|images)|only the best|ảnh đẹp nhất|chỉ.*(ảnh tốt|ảnh đẹp)/i.test(prompt)) return { mode: "best_only" };
  // Ambiguous intent must preserve memories rather than silently discard them.
  return { mode: "keep_all" };
}

let raw = deterministicPolicy();
if (hasKey()) {
  raw = await callDeepSeekJSON({
    temperature: 0,
    system: `Infer photo selection intent only. Return JSON: {mode:"keep_all"|"best_only"|"hybrid", keepCategories?:string[], optimizeCategories?:string[], reason:string}. Use hybrid only when the user explicitly distinguishes categories. Allowed categories: ${[...categories].join(", ")}. If intent is ambiguous choose keep_all. Never reinterpret story or visual style as permission to remove photos.`,
    user: prompt,
  });
}

const mode = oneOf(raw?.mode, modes, deterministicPolicy().mode);
const policy = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generatedBy: provenance(),
  source: project.rel(promptRel),
  mode,
  ...(mode === "hybrid" ? {
    keepCategories: filterVocab(raw.keepCategories, categories),
    optimizeCategories: filterVocab(raw.optimizeCategories, categories),
  } : {}),
  reason: str(raw?.reason, 240) || "Selection intent derived conservatively from the user prompt.",
};
if (mode === "hybrid" && (!policy.keepCategories.length || !policy.optimizeCategories.length)) {
  policy.mode = "keep_all";
  delete policy.keepCategories;
  delete policy.optimizeCategories;
  policy.reason = "Incomplete hybrid policy fell back to keep_all.";
}
const rel = project.manifest.selectionPolicy || "analysis/selection_policy.json";
const out = project.abs(rel);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(policy, null, 2) + "\n");
console.log(`Wrote ${project.rel(rel)}: mode=${policy.mode}, ${policy.generatedBy}.`);
