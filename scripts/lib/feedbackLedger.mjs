import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ALLOWED = new Set(["preview_selected", "preview_approved", "revision_requested", "qa_completed", "delivered"]);
export function anonymousProjectId(value) { return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 16); }
export function appendFeedback({ root = process.cwd(), analysisDir = "analysis", projectId, type, recipeId, pacing, data = {} }) {
  if (!ALLOWED.has(type)) throw new Error(`Unknown feedback event: ${type}`);
  const safe = {};
  for (const key of ["source", "late", "revisions", "openIssues", "clean", "capacityLimited", "qaVerdict"]) if (data[key] !== undefined) safe[key] = data[key];
  const row = { version: 1, at: new Date().toISOString(), project: anonymousProjectId(projectId), type,
    recipeId: recipeId || null, pacing: pacing || null, data: safe };
  const file = path.resolve(root, analysisDir, "feedback.jsonl"); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n"); return row;
}

export function aggregateFeedback(events) {
  const weights = { preview_selected: 3, preview_approved: 4, revision_requested: -3, delivered: 2 };
  const groups = new Map();
  for (const e of events) {
    if (!e.recipeId) continue;
    const key = `${e.recipeId}::${e.pacing || "unknown"}`;
    if (!groups.has(key)) groups.set(key, { recipeId: e.recipeId, pacing: e.pacing || "unknown", rawScore: 0, signals: 0, events: {}, projects: new Set() });
    const g = groups.get(key); g.events[e.type] = (g.events[e.type] || 0) + 1; g.projects.add(e.project);
    let value = weights[e.type] || 0;
    if (e.type === "preview_approved" && e.data?.source === "auto") value = 1;
    if (e.type === "qa_completed") value = (e.data?.clean ? 2 : 0) - (e.data?.revisions || 0) * 0.75 - Math.min(4, e.data?.openIssues || 0);
    if (e.data?.capacityLimited) value -= 1;
    g.rawScore += value; g.signals++;
  }
  return [...groups.values()].map((g) => ({ ...g, projects: g.projects.size, rawScore: +g.rawScore.toFixed(3),
    adjustedScore: +(g.rawScore / (g.signals + 5)).toFixed(3) })).sort((a, b) => b.adjustedScore - a.adjustedScore || b.projects - a.projects);
}
