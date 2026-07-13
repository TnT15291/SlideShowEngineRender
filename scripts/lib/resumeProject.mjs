import fs from "node:fs";
import path from "node:path";
import { validateMusicAnalysis } from "./musicAnalysis.mjs";

const PHASES = ["analyze", "plan", "build", "render", "qa", "deliver"];

function filesIn(target) {
  if (!fs.existsSync(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];
  return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) =>
    filesIn(path.join(target, entry.name))
  );
}

function fresh(inputs, outputs) {
  const inputFiles = inputs.flatMap(filesIn);
  const outputFiles = outputs.flatMap(filesIn);
  if (!outputFiles.length || outputs.some((output) => !fs.existsSync(output))) return false;
  const newestInput = Math.max(0, ...inputFiles.map((file) => fs.statSync(file).mtimeMs));
  const oldestOutput = Math.min(...outputFiles.map((file) => fs.statSync(file).mtimeMs));
  return oldestOutput >= newestInput;
}

export function inspectResume(project) {
  const manifestPath = project.abs(`${project.manifest.analysisDir}/job-manifest.json`);
  if (!fs.existsSync(manifestPath)) return { reusable: new Set(), invalidatedAt: "analyze", reason: "job manifest not found" };

  let previous;
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { reusable: new Set(), invalidatedAt: "analyze", reason: "job manifest is invalid JSON" };
  }
  if (previous.projectId !== project.manifest.id) {
    return { reusable: new Set(), invalidatedAt: "analyze", reason: "job manifest belongs to another project" };
  }

  const analysis = project.manifest.analysisDir;
  const musicAnalysis = project.manifest.music.map((track) => `${analysis}/music/${path.parse(track).name}.json`);
  const timelineBase = path.basename(project.manifest.timeline, path.extname(project.manifest.timeline));
  const rules = {
    analyze: {
      inputs: [project.manifest.inputDir, ...project.manifest.music],
      outputs: [`${analysis}/photos.json`, `${analysis}/photo_content.json`, ...musicAnalysis]
    },
    // directives.json is an OUTPUT of plan (node 0 compiles it) and an INPUT to build.
    // That asymmetry is load-bearing. A revision appends to the ledger and re-runs;
    // if the ledger were a plan INPUT, touching it would make plan stale, node 3 would
    // re-roll the four story options at temperature 0.7, and the customer who asked to
    // "bỏ chữ ở cảnh 12" would be handed a DIFFERENT FILM than the one they approved.
    // As an output, plan stays fresh and only build downwards re-runs — which is the
    // blast-radius rule (see lib/directives.mjs) expressed as a freshness rule.
    plan: {
      inputs: ["project.json", ...(project.manifest.promptFile ? [project.manifest.promptFile] : []), `${analysis}/photos.json`, `${analysis}/photo_content.json`, ...musicAnalysis],
      outputs: [project.manifest.selectionPolicy || `${analysis}/selection_policy.json`, project.manifest.selectedPhotos || `${analysis}/photos.selected.json`, project.manifest.story || `${analysis}/story-template.generated.json`,
        "directives.json",
        ...(project.manifest.tier === "template" ? [`${analysis}/tier1_direction.json`] : [])]
    },
    build: {
      inputs: [project.manifest.selectedPhotos || `${analysis}/photos.selected.json`, project.manifest.story || `${analysis}/story-template.generated.json`,
        "directives.json",
        ...(project.manifest.tier === "template" ? [`${analysis}/tier1_direction.json`] : []), ...musicAnalysis],
      outputs: [project.manifest.timeline]
    },
    render: { inputs: [project.manifest.timeline], outputs: [project.manifest.output] },
    qa: {
      inputs: [project.manifest.timeline, project.manifest.output],
      outputs: [`${analysis}/qa/${timelineBase}.proxy.json`, `${analysis}/qa/${timelineBase}.json`]
    },
    deliver: {
      inputs: [project.manifest.output, `${analysis}/qa/${timelineBase}.proxy.json`, `${analysis}/qa/${timelineBase}.json`],
      outputs: ["output/deliver/final.mp4", "output/deliver/preview.mp4", "output/deliver/thumbnail.jpg", "output/deliver/project_summary.json"]
    }
  };

  const reusable = new Set();
  for (const phase of PHASES) {
    const old = previous.phases?.[phase];
    const tracked = old?.status === "completed" || (old?.status === "skipped" && old.reason?.startsWith("resume:"));
    const rule = rules[phase];
    if (!tracked) return { reusable, invalidatedAt: phase, reason: `previous ${phase} status is ${old?.status || "missing"}` };
    if (!fresh(rule.inputs.map(project.abs), rule.outputs.map(project.abs))) {
      return { reusable, invalidatedAt: phase, reason: `${phase} artifacts are missing or stale` };
    }
    if (phase === "analyze") {
      for (const rel of musicAnalysis) {
        try {
          const checked = validateMusicAnalysis(JSON.parse(fs.readFileSync(project.abs(rel), "utf8")));
          if (!checked.ok) return { reusable, invalidatedAt: "analyze", reason: `music analysis is stale or incomplete: ${checked.missing.join(", ")}` };
        } catch {
          return { reusable, invalidatedAt: "analyze", reason: "music analysis is invalid JSON" };
        }
      }
    }
    reusable.add(phase);
  }
  return { reusable, invalidatedAt: null, reason: "all requested artifacts are fresh" };
}
