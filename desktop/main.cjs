const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const crypto = require("node:crypto");
const { validateFingerprint } = require("../scripts/lib/approvalFingerprint.cjs");
const { currentSelection, validateApprovedSelection } = require("../scripts/lib/previewApproval.cjs");
const ENGINE_ROOT = path.resolve(__dirname, "..");

let mainWindow;
let currentProjectPath = process.cwd();
let activeRender = null;
let lastRenderOutput = null;

const ASSET_DESTINATIONS = {
  font: "fonts",
  overlay: "assets/overlays",
  background: "assets/backgrounds",
  frame: "assets/frames",
};

const ASSET_FILTERS = {
  font: [{ name: "Font files", extensions: ["ttf", "otf"] }],
  overlay: [{ name: "Overlay media", extensions: ["mp4", "mov", "webm", "png", "jpg", "jpeg"] }],
  background: [{ name: "Background media", extensions: ["mp4", "mov", "webm", "png", "jpg", "jpeg"] }],
  frame: [{ name: "Frame images", extensions: ["png", "jpg", "jpeg", "webp"] }],
};

const PHOTO_FILTER = [{ name: "Photo files", extensions: ["jpg", "jpeg", "png", "webp"] }];

function projectSummary(projectPath) {
  const has = (rel) => fs.existsSync(path.join(projectPath, rel));
  const readJson = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectPath, rel), "utf8"));
    } catch {
      return null;
    }
  };
  const assetCatalog = readJson("analysis/assets_catalog.ai.json");
  return {
    path: projectPath,
    name: path.basename(projectPath),
    folders: {
      input: has("input"),
      music: has("music"),
      timeline: has("timeline"),
      analysis: has("analysis"),
      assets: has("assets"),
      fonts: has("fonts"),
      overlays: has("overlays"),
    },
    files: {
      packageJson: has("package.json"),
      timelineSchema: has("schema/timeline.schema.json"),
      assetCatalog: has("analysis/assets_catalog.ai.json"),
    },
    assetCounts: assetCatalog?.counts || null,
  };
}

function safeName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext)
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "asset";
  return `${base}${ext.toLowerCase()}`;
}

function uniqueDestination(dir, fileName) {
  const clean = safeName(fileName);
  const ext = path.extname(clean);
  const base = path.basename(clean, ext);
  let candidate = path.join(dir, clean);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}_${n}${ext}`);
    n += 1;
  }
  return candidate;
}

function readAssetCatalog(projectPath) {
  const fullPath = path.join(projectPath, "analysis/assets_catalog.full.json");
  const aiPath = path.join(projectPath, "analysis/assets_catalog.ai.json");
  const read = (file) => {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  };
  return {
    full: read(fullPath),
    ai: read(aiPath),
    hasFull: fs.existsSync(fullPath),
    hasAi: fs.existsSync(aiPath),
  };
}

function readJsonSafe(projectPath, rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectPath, rel), "utf8"));
  } catch {
    return null;
  }
}

function readDirectorState(projectPath) {
  return {
    photoContent: readJsonSafe(projectPath, "analysis/photo_content.json"),
    storyOptions: readJsonSafe(projectPath, "analysis/story_options.json"),
    directorNotes: readJsonSafe(projectPath, "analysis/director_notes.json"),
    storyPlan: readJsonSafe(projectPath, "analysis/story_plan.json"),
  };
}

function previewState(projectPath) {
  const manifest = readJsonSafe(projectPath, "output/previews/directions.json");
  const selection = readJsonSafe(projectPath, "analysis/previews/selection.json");
  const activeSelection = currentSelection(manifest, selection);
  const variants = (manifest?.variants || []).map((v) => {
    const absVideo = v.video ? path.resolve(ENGINE_ROOT, v.video) : null;
    return { ...v, videoUrl: absVideo && fs.existsSync(absVideo) ? pathToFileURL(absVideo).href : null,
      selected: activeSelection?.id === v.id };
  });
  return { available: variants.length > 0, generatedAt: manifest?.generatedAt || null, dryRun: manifest?.dryRun || false,
    variants, selection: activeSelection, approved: activeSelection?.status === "approved",
    projectManifest: readJsonSafe(projectPath, "project.json") };
}

function projectArg(projectPath) {
  const rel = path.relative(ENGINE_ROOT, projectPath).replace(/\\/g, "/");
  if (rel.startsWith("../") || path.isAbsolute(rel)) throw new Error("Selected project must be inside the engine workspace");
  return rel;
}

function runEngine(args) { return runNode(ENGINE_ROOT, args); }

async function generatePreviews(payload = {}) {
  const manifest = readJsonSafe(currentProjectPath, "project.json");
  if (!manifest?.recipe) return { ok: false, stderr: "project.json must pin a Tier 1 recipe before generating previews." };
  const result = await runEngine(["scripts/generateTier1Previews.mjs", "--project", projectArg(currentProjectPath),
    "--recipe", manifest.recipe, "--duration", String(payload.duration || 20)]);
  return { ...result, state: previewState(currentProjectPath) };
}

function selectPreview(id) {
  const state = previewState(currentProjectPath), chosen = state.variants.find((v) => v.id === id);
  if (!chosen) return { ok: false, message: `Unknown preview direction: ${id}` };
  const selection = { version: 2, status: "selected", id, selectedAt: new Date().toISOString(), previewGeneratedAt: state.generatedAt,
    direction: chosen.direction, timeline: chosen.timeline, video: chosen.video, recipeId: chosen.recipeId, fingerprint: chosen.fingerprint };
  const dest = path.join(currentProjectPath, "analysis", "previews", "selection.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, JSON.stringify(selection, null, 2) + "\n");
  const ledger = path.join(currentProjectPath, "analysis", "feedback.jsonl");
  const projectId = crypto.createHash("sha256").update(String(state.projectManifest?.id || path.basename(currentProjectPath))).digest("hex").slice(0, 16);
  fs.appendFileSync(ledger, JSON.stringify({ version: 1, at: new Date().toISOString(), project: projectId, type: "preview_selected",
    recipeId: chosen.recipeId, pacing: chosen.id, data: { capacityLimited: Boolean(chosen.pacing?.capacityLimited) } }) + "\n");
  return { ok: true, state: previewState(currentProjectPath) };
}

function approvePreview() {
  const state = previewState(currentProjectPath), selection = state.selection;
  if (!selection) return { ok: false, message: "Choose a preview direction first." };
  const validity = validateFingerprint(ENGINE_ROOT, selection.fingerprint);
  if (!validity.ok) return { ok: false, message: validity.reason };
  selection.status = "approved"; selection.approvedAt = new Date().toISOString();
  const dest = path.join(currentProjectPath, "analysis", "previews", "selection.json");
  fs.writeFileSync(dest, JSON.stringify(selection, null, 2) + "\n");
  const ledger = path.join(currentProjectPath, "analysis", "feedback.jsonl");
  const projectId = crypto.createHash("sha256").update(String(state.projectManifest?.id || path.basename(currentProjectPath))).digest("hex").slice(0, 16);
  fs.appendFileSync(ledger, JSON.stringify({ version: 1, at: selection.approvedAt, project: projectId,
    type: "preview_approved", recipeId: selection.recipeId, pacing: selection.id, data: { source: "user" } }) + "\n");
  return { ok: true, state: previewState(currentProjectPath) };
}

async function renderSelectedPreview() {
  const state = previewState(currentProjectPath), selected = state.selection;
  const manifest = state.projectManifest;
  const previewManifest = readJsonSafe(currentProjectPath, "output/previews/directions.json");
  const validity = validateApprovedSelection(ENGINE_ROOT, previewManifest, selected, manifest);
  if (!validity.ok) return { ok: false, stderr: validity.reason };
  const result = await runEngine(["scripts/runProject.mjs", "--project", projectArg(currentProjectPath), "--tier", "template",
    "--recipe", selected.recipeId, "--direction", selected.direction, "--deliver"]);
  return { ...result, state: previewState(currentProjectPath), project: projectSummary(currentProjectPath) };
}

function runAnalyzeAssets(projectPath) {
  return runNode(projectPath, ["scripts/analyzeAssets.mjs"]);
}

function runNode(projectPath, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: projectPath,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}${err.message}` });
    });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function toProjectRelative(projectPath, filePath) {
  const rel = path.relative(projectPath, filePath).replace(/\\/g, "/");
  return rel.startsWith("../") || rel === ".." || path.isAbsolute(rel) ? null : rel;
}

function cleanProjectRelative(value) {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return null;
  if (path.isAbsolute(raw)) {
    const rel = toProjectRelative(currentProjectPath, raw);
    return rel;
  }
  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

async function chooseMusicFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose music track",
    properties: ["openFile"],
    filters: [{ name: "Audio files", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const selected = result.filePaths[0];
  const alreadyInside = toProjectRelative(currentProjectPath, selected);
  if (alreadyInside) return { ok: true, path: alreadyInside };
  const destDir = path.join(currentProjectPath, "music");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = uniqueDestination(destDir, path.basename(selected));
  fs.copyFileSync(selected, dest);
  return { ok: true, path: path.relative(currentProjectPath, dest).replace(/\\/g, "/"), copied: true };
}

/**
 * Build a timeline: solve the shot list, optionally have the AI write its words,
 * then render it through the recipe engine.
 *
 * This replaces generateStoryClipV2, which carried 16 fixed scenes and 12 fixed
 * lines of text written for one wedding — so every project opened in this app got
 * that couple's names on screen, and a shot list that asked for 42 photo slots
 * whether you had 23 photos or 200. The scene count now follows the music and the
 * photo budget (scripts/lib/storyboard.mjs).
 */
async function buildTimeline({ musicPath, timelinePath, director, plan, withCopy = false, musicMode = "auto" }) {
  fs.mkdirSync(path.dirname(path.join(currentProjectPath, timelinePath)), { recursive: true });
  const name = path.basename(timelinePath).replace(/\.[^.]+$/, "");
  const storyboard = "analysis/storyboard.json";
  const copy = "analysis/recipe_copy.json";
  const briefPath = path.join(currentProjectPath, "brief.json");
  let out = "";
  let err = "";

  const compose = await runNode(currentProjectPath, [
    "scripts/composeStoryboard.mjs",
    "--photos", "analysis/photos.json",
    "--music", musicPath,
    "--director", director,
    "--plan", plan,
    "--name", name,
    "--music-mode", musicMode,
    "--out", storyboard,
  ]);
  out += compose.stdout; err += compose.stderr;
  if (!compose.ok) return { ...compose, step: "composeStoryboard", timelinePath, project: projectSummary(currentProjectPath) };

  if (withCopy) {
    const words = await runNode(currentProjectPath, [
      "scripts/writeRecipeCopy.mjs",
      "--recipe", storyboard,
      "--content", "analysis/photo_content.json",
      "--out", copy,
    ]);
    out += words.stdout; err += words.stderr;
    if (!words.ok) return { ...words, step: "writeRecipeCopy", timelinePath, project: projectSummary(currentProjectPath) };
  }

  const render = await runNode(currentProjectPath, [
    "scripts/applyStoryTemplate.mjs",
    "--template", storyboard,
    "--photos", "analysis/photos.json",
    "--music", musicPath,
    "--out", timelinePath,
    "--output", `output/${name}.mp4`,
    "--name", name,
    ...(withCopy ? ["--copy", copy] : []),
    // The couple's names and their date. Never written by the model — it invented
    // "Linh & Nam" once, and a fabricated name on a wedding film's last frame is
    // not a wording problem, it is the wrong film.
    ...(fs.existsSync(briefPath) ? ["--brief", "brief.json"] : []),
  ]);
  out += render.stdout; err += render.stderr;
  if (!render.ok) return { ...render, step: "applyStoryTemplate", timelinePath, project: projectSummary(currentProjectPath) };

  const fit = await runNode(currentProjectPath, ["scripts/fitTextInTimeline.mjs", timelinePath]);
  return {
    ok: fit.ok,
    code: fit.code,
    step: "fitTextInTimeline",
    stdout: `${out}${fit.stdout}`,
    stderr: `${err}${fit.stderr}`,
    timelinePath,
    project: projectSummary(currentProjectPath),
  };
}

async function runPipelineStep(step, payload = {}) {
  const musicPath = cleanProjectRelative(payload.musicPath || "music/a thousand years.mp3");
  const timelinePath = cleanProjectRelative(payload.timelinePath || "timeline/desktop-lite.json");
  if (!musicPath) return { ok: false, code: -1, stdout: "", stderr: "Invalid music path." };
  if (!timelinePath) return { ok: false, code: -1, stdout: "", stderr: "Invalid timeline path." };

  if (step === "analyze") {
    const photos = await runNode(currentProjectPath, ["scripts/analyzePhotos.mjs"]);
    if (!photos.ok) return { ...photos, step: "analyzePhotos", project: projectSummary(currentProjectPath) };
    const music = await runNode(currentProjectPath, ["scripts/analyzeMusic.mjs", musicPath]);
    return {
      ok: music.ok,
      code: music.code,
      step: "analyzeMusic",
      stdout: `${photos.stdout}${music.stdout}`,
      stderr: `${photos.stderr}${music.stderr}`,
      project: projectSummary(currentProjectPath),
    };
  }

  if (step === "generate") {
    return buildTimeline({ musicPath, timelinePath, director: "none", plan: "none", musicMode: payload.musicMode });
  }

  if (step === "dryRun") {
    const dryRun = await runNode(currentProjectPath, [
      "--import", "tsx",
      "src/index.ts",
      "--timeline", timelinePath,
      "--dry-run",
    ]);
    return { ...dryRun, step: "dryRun", timelinePath, project: projectSummary(currentProjectPath) };
  }

  return { ok: false, code: -1, stdout: "", stderr: `Unknown pipeline step: ${step}` };
}

async function runDirectorStep(step, payload = {}) {
  const musicPath = cleanProjectRelative(payload.musicPath || "music/a thousand years.mp3");
  const timelinePath = cleanProjectRelative(payload.timelinePath || "timeline/desktop-director.json");
  const brief = String(payload.brief || "").trim();
  const choice = /^[ABCD]$/.test(String(payload.choice || "").toUpperCase())
    ? String(payload.choice).toUpperCase()
    : "A";
  if (!musicPath) return { ok: false, code: -1, stdout: "", stderr: "Invalid music path." };
  if (!timelinePath) return { ok: false, code: -1, stdout: "", stderr: "Invalid timeline path." };

  if (step === "semantics") {
    const result = await runNode(currentProjectPath, ["scripts/analyzePhotoContent.mjs"]);
    return { ...result, step, state: readDirectorState(currentProjectPath), project: projectSummary(currentProjectPath) };
  }

  if (step === "options") {
    const args = ["scripts/generateStoryOptions.mjs"];
    if (brief) args.push("--brief", brief);
    const result = await runNode(currentProjectPath, args);
    return { ...result, step, state: readDirectorState(currentProjectPath), project: projectSummary(currentProjectPath) };
  }

  if (step === "notes") {
    const result = await runNode(currentProjectPath, [
      "scripts/generateDirectorNotes.mjs",
      "--choice", choice,
      "--music", musicPath,
      "--assets", "analysis/assets_catalog.ai.json",
    ]);
    return { ...result, step, state: readDirectorState(currentProjectPath), project: projectSummary(currentProjectPath) };
  }

  if (step === "plan") {
    const result = await runNode(currentProjectPath, ["scripts/generateStoryPlan.mjs"]);
    return { ...result, step, state: readDirectorState(currentProjectPath), project: projectSummary(currentProjectPath) };
  }

  if (step === "timeline") {
    const built = await buildTimeline({
      musicPath,
      timelinePath,
      director: "analysis/director_notes.json",
      plan: "analysis/story_plan.json",
      withCopy: true,
    });
    return { ...built, step, state: readDirectorState(currentProjectPath) };
  }

  return { ok: false, code: -1, stdout: "", stderr: `Unknown director step: ${step}` };
}

function readTimelineOutput(projectPath, timelinePath) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(projectPath, timelinePath), "utf8"));
    return cleanProjectRelative(doc?.output?.path || "");
  } catch {
    return null;
  }
}

function timelinePathFromPayload(payload = {}) {
  const timelinePath = cleanProjectRelative(payload.timelinePath || "timeline/desktop-lite.json");
  if (!timelinePath) return { ok: false, message: "Invalid timeline path." };
  const abs = path.join(currentProjectPath, timelinePath);
  if (!fs.existsSync(abs)) return { ok: false, message: `Timeline not found: ${timelinePath}` };
  return { ok: true, timelinePath, abs };
}

function readTimeline(payload = {}) {
  const target = timelinePathFromPayload(payload);
  if (!target.ok) return target;
  try {
    const timeline = JSON.parse(fs.readFileSync(target.abs, "utf8"));
    return { ok: true, timelinePath: target.timelinePath, timeline };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

function writeTimeline(payload = {}) {
  const target = timelinePathFromPayload(payload);
  if (!target.ok) return target;
  try {
    const timeline = JSON.parse(fs.readFileSync(target.abs, "utf8"));
    const slide = (timeline.slides || []).find((s) => s.id === payload.slideId);
    if (!slide) return { ok: false, message: `Slide not found: ${payload.slideId}` };

    const duration = Number(payload.duration);
    if (Number.isFinite(duration)) slide.duration = Math.max(2, Math.min(30, duration));

    for (const update of payload.textUpdates || []) {
      if (update.kind === "layer" && slide.layers?.[update.index]?.type === "text") {
        slide.layers[update.index].text = String(update.text || "");
      }
      if (update.kind === "caption" && slide.captions?.[update.index]) {
        slide.captions[update.index].text = String(update.text || "");
      }
    }

    for (const update of payload.imageUpdates || []) {
      if (update.kind === "layer" && slide.layers?.[update.index]?.type === "image") {
        slide.layers[update.index].path = String(update.path || slide.layers[update.index].path);
      }
      if (update.kind === "image") slide.image = String(update.path || slide.image);
      if (update.kind === "images" && Array.isArray(slide.images) && slide.images[update.index]) {
        slide.images[update.index] = String(update.path || slide.images[update.index]);
      }
    }

    fs.writeFileSync(target.abs, JSON.stringify(timeline, null, 2));
    return { ok: true, timelinePath: target.timelinePath, timeline };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function chooseTimelineImage() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose replacement photo",
    properties: ["openFile"],
    filters: PHOTO_FILTER,
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const selected = result.filePaths[0];
  const alreadyInside = toProjectRelative(currentProjectPath, selected);
  if (alreadyInside) return { ok: true, path: alreadyInside };
  const destDir = path.join(currentProjectPath, "input");
  fs.mkdirSync(destDir, { recursive: true });
  const dest = uniqueDestination(destDir, path.basename(selected));
  fs.copyFileSync(selected, dest);
  return { ok: true, path: path.relative(currentProjectPath, dest).replace(/\\/g, "/"), copied: true };
}

function sendRenderEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("render:event", event);
  }
}

function startRender(payload = {}) {
  if (activeRender) {
    return { ok: false, message: "A render is already running." };
  }
  const timelinePath = cleanProjectRelative(payload.timelinePath || "timeline/desktop-lite.json");
  if (!timelinePath) return { ok: false, message: "Invalid timeline path." };
  if (!fs.existsSync(path.join(currentProjectPath, timelinePath))) {
    return { ok: false, message: `Timeline not found: ${timelinePath}` };
  }

  const outputPath = readTimelineOutput(currentProjectPath, timelinePath);
  lastRenderOutput = outputPath;
  const child = spawn(process.execPath, [
    "--import", "tsx",
    "src/index.ts",
    "--timeline", timelinePath,
  ], {
    cwd: currentProjectPath,
    windowsHide: true,
  });
  activeRender = child;

  sendRenderEvent({ type: "start", timelinePath, outputPath });
  child.stdout.on("data", (d) => sendRenderEvent({ type: "log", stream: "stdout", text: d.toString() }));
  child.stderr.on("data", (d) => sendRenderEvent({ type: "log", stream: "stderr", text: d.toString() }));
  child.on("error", (err) => {
    activeRender = null;
    sendRenderEvent({ type: "error", message: err.message });
  });
  child.on("close", (code) => {
    activeRender = null;
    sendRenderEvent({
      type: "exit",
      code,
      ok: code === 0,
      outputPath,
      project: projectSummary(currentProjectPath),
    });
  });
  return { ok: true, timelinePath, outputPath };
}

function cancelRender() {
  if (!activeRender) return { ok: false, message: "No render is running." };
  activeRender.kill();
  return { ok: true };
}

function openLastRenderOutput() {
  if (!lastRenderOutput) return { ok: false, message: "No rendered output path is known yet." };
  const abs = path.join(currentProjectPath, lastRenderOutput);
  if (!fs.existsSync(abs)) return { ok: false, message: `Output not found: ${lastRenderOutput}` };
  shell.showItemInFolder(abs);
  return { ok: true, path: lastRenderOutput };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: "Wedding Render Studio",
    backgroundColor: "#f6f2ea",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("project:current", () => projectSummary(currentProjectPath));
  ipcMain.handle("project:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Slideshow Project Folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    currentProjectPath = result.filePaths[0];
    return projectSummary(currentProjectPath);
  });
  ipcMain.handle("assets:catalog", () => readAssetCatalog(currentProjectPath));
  ipcMain.handle("assets:import", async (_event, type) => {
    const relDest = ASSET_DESTINATIONS[type];
    if (!relDest) return { ok: false, message: `Unknown asset type: ${type}` };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Import ${type}`,
      properties: ["openFile", "multiSelections"],
      filters: ASSET_FILTERS[type] || [{ name: "All files", extensions: ["*"] }],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const destDir = path.join(currentProjectPath, relDest);
    fs.mkdirSync(destDir, { recursive: true });
    const imported = [];
    for (const src of result.filePaths) {
      const dest = uniqueDestination(destDir, path.basename(src));
      fs.copyFileSync(src, dest);
      imported.push(path.relative(currentProjectPath, dest).replace(/\\/g, "/"));
    }
    return { ok: true, imported, project: projectSummary(currentProjectPath) };
  });
  ipcMain.handle("assets:analyze", async () => {
    const result = await runAnalyzeAssets(currentProjectPath);
    return {
      ...result,
      catalog: readAssetCatalog(currentProjectPath),
      project: projectSummary(currentProjectPath),
    };
  });
  ipcMain.handle("pipeline:chooseMusic", chooseMusicFile);
  ipcMain.handle("pipeline:run", (_event, step, payload) => runPipelineStep(step, payload));
  ipcMain.handle("director:state", () => readDirectorState(currentProjectPath));
  ipcMain.handle("director:run", (_event, step, payload) => runDirectorStep(step, payload));
  ipcMain.handle("preview:state", () => previewState(currentProjectPath));
  ipcMain.handle("preview:generate", (_event, payload) => generatePreviews(payload));
  ipcMain.handle("preview:select", (_event, id) => selectPreview(id));
  ipcMain.handle("preview:approve", () => approvePreview());
  ipcMain.handle("preview:renderFull", () => renderSelectedPreview());
  ipcMain.handle("timeline:read", (_event, payload) => readTimeline(payload));
  ipcMain.handle("timeline:write", (_event, payload) => writeTimeline(payload));
  ipcMain.handle("timeline:chooseImage", chooseTimelineImage);
  ipcMain.handle("render:start", (_event, payload) => startRender(payload));
  ipcMain.handle("render:cancel", cancelRender);
  ipcMain.handle("render:openOutput", openLastRenderOutput);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
