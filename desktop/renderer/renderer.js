const folderLabels = {
  input: "Input photos",
  music: "Music",
  timeline: "Timelines",
  analysis: "Analysis",
  assets: "Assets",
  fonts: "Fonts",
  overlays: "Overlays",
};

const fileLabels = {
  packageJson: "package.json",
  timelineSchema: "Timeline schema",
  assetCatalog: "AI asset catalog",
};

const assetLabels = {
  fonts: "Fonts",
  overlays: "Overlays",
  backgrounds: "Backgrounds",
  frames: "Frames",
};

const $ = (id) => document.getElementById(id);
let currentProject = null;
let currentCatalog = null;
let currentDirectorState = null;
let currentTimeline = null;
let selectedSlideId = null;
let renderProgress = { slide: 0, total: 0, phase: "Waiting to render", percent: 0 };

function checkRow(label, ok) {
  const row = document.createElement("div");
  row.className = "check-row";
  const name = document.createElement("span");
  name.textContent = label;
  const badge = document.createElement("span");
  badge.className = `check-badge ${ok ? "ok" : "missing"}`;
  badge.textContent = ok ? "Ready" : "Missing";
  row.append(name, badge);
  return row;
}

function countRow(label, count) {
  const row = document.createElement("div");
  row.className = "count-row";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("strong");
  value.textContent = String(count);
  row.append(name, value);
  return row;
}

function valueRow(label, value) {
  const row = document.createElement("div");
  row.className = "count-row";
  const name = document.createElement("span");
  name.textContent = label;
  const val = document.createElement("strong");
  val.textContent = value || "-";
  row.append(name, val);
  return row;
}

function renderChecks(container, labels, values) {
  container.replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    container.append(checkRow(label, Boolean(values?.[key])));
  }
}

function renderAssetCounts(container, counts) {
  container.replaceChildren();
  if (!counts) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No catalog found yet. Run Analyze Assets to build the AI Director menu.";
    container.append(note);
    return;
  }
  for (const [key, label] of Object.entries(assetLabels)) {
    container.append(countRow(label, counts[key] ?? 0));
  }
}

function firstWords(text, max = 92) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function renderAssetList(container, catalog) {
  container.replaceChildren();
  const ai = catalog?.ai;
  if (!ai) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No AI catalog available. Import resources or run Analyze Assets.";
    container.append(note);
    return;
  }

  const groups = [
    ["fonts", "Fonts"],
    ["overlays", "Overlays"],
    ["backgrounds", "Backgrounds"],
    ["frames", "Frames"],
  ];

  for (const [key, label] of groups) {
    const items = Array.isArray(ai[key]) ? ai[key].slice(0, 8) : [];
    const section = document.createElement("section");
    section.className = "asset-section";
    const heading = document.createElement("h5");
    heading.textContent = `${label} (${ai.counts?.[key] ?? items.length})`;
    const list = document.createElement("div");
    list.className = "asset-items";
    if (!items.length) {
      const note = document.createElement("p");
      note.className = "empty-note";
      note.textContent = "No items.";
      list.append(note);
    } else {
      for (const item of items) {
        const card = document.createElement("div");
        card.className = "asset-item";
        const title = document.createElement("strong");
        title.textContent = item.label || item.id;
        const meta = document.createElement("span");
        const tags = [...(item.mood || []), ...(item.bestFor || [])].slice(0, 5).join(", ");
        meta.textContent = firstWords(item.summary || tags || item.id);
        card.append(title, meta);
        list.append(card);
      }
    }
    section.append(heading, list);
    container.append(section);
  }
}

function renderAssets(catalog = currentCatalog) {
  currentCatalog = catalog;
  renderAssetCounts($("assetManagerCounts"), catalog?.ai?.counts);
  renderAssetList($("assetList"), catalog);
}

function renderProject(project) {
  currentProject = project;
  $("projectName").textContent = project?.name || "No project selected";
  $("projectPath").textContent = project?.path || "";

  renderChecks($("folderChecks"), folderLabels, project?.folders);
  renderChecks($("fileChecks"), fileLabels, project?.files);
  renderAssetCounts($("assetCounts"), project?.assetCounts);

  const requiredReady = Boolean(project?.files?.packageJson && project?.files?.timelineSchema);
  const status = $("projectStatus");
  status.className = `status-pill ${requiredReady ? "ready" : "warning"}`;
  status.textContent = requiredReady ? "Ready" : "Needs setup";
}

function showMessage(text, kind = "") {
  const el = $("assetMessage");
  el.className = `message-line ${kind}`;
  el.textContent = text;
}

function setView(view) {
  const isAssets = view === "assets";
  const isPipeline = view === "pipeline";
  const isRender = view === "render";
  const isDirector = view === "director";
  const isTimeline = view === "timeline";
  $("projectView").classList.toggle("hidden", view !== "project");
  $("assetsView").classList.toggle("hidden", !isAssets);
  $("pipelineView").classList.toggle("hidden", !isPipeline);
  $("directorView").classList.toggle("hidden", !isDirector);
  $("timelineView").classList.toggle("hidden", !isTimeline);
  $("renderView").classList.toggle("hidden", !isRender);
  $("viewEyebrow").textContent = isAssets ? "Step 2" : isPipeline ? "Step 3" : isRender ? "Step 4" : isDirector ? "Step 5" : isTimeline ? "Step 6" : "Step 1";
  $("viewTitle").textContent = isAssets ? "Asset Manager" : isPipeline ? "Lite Pipeline" : isRender ? "Render Queue" : isDirector ? "AI Director" : isTimeline ? "Timeline Editor" : "Project Workspace";
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (isAssets) refreshCatalog();
  if (isRender) $("renderTimelinePath").value = $("timelinePath").value;
  if (isDirector) refreshDirectorState();
  if (isTimeline) $("timelineEditorPath").value = $("timelinePath").value || $("directorTimelinePath").value;
}

function pipelinePayload() {
  return {
    musicPath: $("musicPath").value,
    timelinePath: $("timelinePath").value,
  };
}

function appendPipelineLog(text) {
  const log = $("pipelineLog");
  log.textContent = `${log.textContent}${log.textContent.endsWith("\n") ? "" : "\n"}${text}`;
  log.scrollTop = log.scrollHeight;
}

function appendRenderLog(text) {
  const log = $("renderLog");
  log.textContent = `${log.textContent}${log.textContent.endsWith("\n") ? "" : "\n"}${text}`;
  log.scrollTop = log.scrollHeight;
}

function appendDirectorLog(text) {
  const log = $("directorLog");
  log.textContent = `${log.textContent}${log.textContent.endsWith("\n") ? "" : "\n"}${text}`;
  log.scrollTop = log.scrollHeight;
}

function setPipelineBusy(busy) {
  ["analyzeInputs", "generateLite", "dryRunTimeline", "chooseMusic"].forEach((id) => {
    $(id).disabled = busy;
  });
}

function setRenderBusy(busy) {
  $("startRender").disabled = busy;
  $("cancelRender").disabled = !busy;
  $("renderStatus").className = `status-pill ${busy ? "warning" : ""}`;
  $("renderStatus").textContent = busy ? "Running" : "Idle";
}

function renderPayload() {
  return { timelinePath: $("renderTimelinePath").value || $("timelinePath").value };
}

function setRenderProgress({ percent, phase, slide, total }) {
  if (Number.isFinite(percent)) renderProgress.percent = Math.max(0, Math.min(100, percent));
  if (phase) renderProgress.phase = phase;
  if (Number.isFinite(slide)) renderProgress.slide = slide;
  if (Number.isFinite(total)) renderProgress.total = total;
  $("renderProgressBar").style.width = `${renderProgress.percent}%`;
  $("renderPercent").textContent = `${Math.round(renderProgress.percent)}%`;
  const slideText = renderProgress.total ? ` (${renderProgress.slide}/${renderProgress.total})` : "";
  $("renderPhase").textContent = `${renderProgress.phase}${slideText}`;
}

function resetRenderProgress() {
  renderProgress = { slide: 0, total: 0, phase: "Waiting to render", percent: 0 };
  setRenderProgress(renderProgress);
}

function updateRenderProgressFromLog(text) {
  const slideMatch = text.match(/Rendering slide\s+(\d+)\/(\d+):\s+([^\s]+)/);
  if (slideMatch) {
    const slide = Number(slideMatch[1]);
    const total = Number(slideMatch[2]);
    const percent = total ? (slide - 1) / total * 72 : 0;
    setRenderProgress({ slide, total, percent, phase: `Rendering ${slideMatch[3]}` });
    return;
  }
  if (/All \d+ slides rendered/.test(text)) {
    setRenderProgress({ percent: 74, phase: "Slides rendered" });
    return;
  }
  if (/Combining .*transitions|xfade/i.test(text)) {
    setRenderProgress({ percent: 82, phase: "Combining transitions" });
    return;
  }
  if (/Applying \d+ overlay/.test(text)) {
    setRenderProgress({ percent: 90, phase: "Applying overlays" });
    return;
  }
  if (/Adding audio/.test(text)) {
    setRenderProgress({ percent: 96, phase: "Muxing audio" });
    return;
  }
  if (/Final video written/.test(text)) {
    setRenderProgress({ percent: 99, phase: "Finalizing" });
  }
}

function directorPayload() {
  return {
    brief: $("directorBrief").value,
    choice: $("storyChoice").value,
    musicPath: $("musicPath").value,
    timelinePath: $("directorTimelinePath").value,
  };
}

function setDirectorBusy(busy) {
  ["analyzeSemantics", "generateOptions", "generateNotes", "generatePlan", "generateDirectorTimeline"].forEach((id) => {
    $(id).disabled = busy;
  });
}

function renderDirectorState(state = currentDirectorState) {
  currentDirectorState = state;
  const optionsContainer = $("storyOptionsList");
  optionsContainer.replaceChildren();
  const options = state?.storyOptions?.options || [];
  if (!options.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No story options yet.";
    optionsContainer.append(note);
  } else {
    for (const option of options) {
      const card = document.createElement("div");
      card.className = `story-option ${$("storyChoice").value === option.id ? "selected" : ""}`;
      const title = document.createElement("strong");
      title.textContent = `${option.id}. ${option.title}`;
      const meta = document.createElement("span");
      meta.textContent = `${option.mood || ""} | ${option.pacing || ""}`;
      const summary = document.createElement("span");
      summary.textContent = option.summary || "";
      card.append(title, meta, summary);
      card.addEventListener("click", () => {
        $("storyChoice").value = option.id;
        renderDirectorState(currentDirectorState);
      });
      optionsContainer.append(card);
    }
  }

  const choices = state?.directorNotes?.asset_choices || {};
  const choicesContainer = $("assetChoicesList");
  choicesContainer.replaceChildren();
  for (const [label, key] of [
    ["Title font", "titleFontId"],
    ["Body font", "bodyFontId"],
    ["Overlay", "overlayId"],
    ["Opening bg", "openingBackgroundId"],
    ["Ending bg", "endingBackgroundId"],
    ["Frame", "frameId"],
  ]) {
    choicesContainer.append(valueRow(label, choices[key]));
  }
}

async function refreshDirectorState() {
  const state = await window.studio.directorState();
  renderDirectorState(state);
}

async function runDirectorStep(step, label) {
  setDirectorBusy(true);
  appendDirectorLog(`\n> ${label}`);
  try {
    const result = await window.studio.runDirector(step, directorPayload());
    if (result.project) renderProject(result.project);
    if (result.state) renderDirectorState(result.state);
    const body = [result.stdout, result.stderr].filter(Boolean).join("\n");
    appendDirectorLog(body || "(no output)");
    appendDirectorLog(result.ok ? `OK: ${label} completed.` : `FAILED: ${label} failed with code ${result.code}.`);
    if (step === "timeline" && result.timelinePath) {
      $("timelinePath").value = result.timelinePath;
      $("renderTimelinePath").value = result.timelinePath;
    }
  } catch (err) {
    appendDirectorLog(`FAILED: ${label} failed: ${err?.message || err}`);
  } finally {
    setDirectorBusy(false);
  }
}

function showTimelineMessage(text, kind = "") {
  const el = $("timelineMessage");
  el.className = `message-line ${kind}`;
  el.textContent = text;
}

function selectedSlide() {
  return (currentTimeline?.slides || []).find((s) => s.id === selectedSlideId) || null;
}

function textItems(slide) {
  const items = [];
  (slide.layers || []).forEach((layer, index) => {
    if (layer.type === "text") items.push({ kind: "layer", index, text: layer.text || "", label: `Layer ${index}` });
  });
  (slide.captions || []).forEach((caption, index) => {
    items.push({ kind: "caption", index, text: caption.text || "", label: `Caption ${index}` });
  });
  return items;
}

function imageItems(slide) {
  const items = [];
  if (slide.image) items.push({ kind: "image", index: 0, path: slide.image, label: "Image" });
  (slide.images || []).forEach((img, index) => items.push({ kind: "images", index, path: img, label: `Image ${index}` }));
  (slide.layers || []).forEach((layer, index) => {
    if (layer.type === "image") items.push({ kind: "layer", index, path: layer.path, label: `Layer ${index}` });
  });
  return items;
}

function renderSlideList() {
  const container = $("slideList");
  container.replaceChildren();
  const slides = currentTimeline?.slides || [];
  if (!slides.length) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No timeline loaded.";
    container.append(note);
    return;
  }
  for (const slide of slides) {
    const btn = document.createElement("button");
    btn.className = `slide-button ${slide.id === selectedSlideId ? "active" : ""}`;
    btn.type = "button";
    const title = document.createElement("strong");
    title.textContent = slide.id;
    const meta = document.createElement("span");
    meta.textContent = `${slide.effect} | ${slide.duration}s`;
    btn.append(title, meta);
    btn.addEventListener("click", () => {
      selectedSlideId = slide.id;
      renderSlideList();
      renderSlideEditor();
    });
    container.append(btn);
  }
}

function renderSlideEditor() {
  const slide = selectedSlide();
  const container = $("slideEditor");
  container.replaceChildren();
  $("slideEditorTitle").textContent = slide ? `Slide ${slide.id}` : "No slide selected";
  if (!slide) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "Select a scene to edit.";
    container.append(note);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "editor-grid";
  const duration = document.createElement("label");
  duration.className = "field-label";
  duration.innerHTML = `Duration<input id="editDuration" class="text-input" type="number" min="2" max="30" step="0.1" value="${slide.duration}" />`;
  const effect = document.createElement("label");
  effect.className = "field-label";
  effect.innerHTML = `Effect<input class="text-input" value="${slide.effect}" disabled />`;
  const transition = document.createElement("label");
  transition.className = "field-label";
  transition.innerHTML = `Transition<input class="text-input" value="${slide.transition?.type || "none"}" disabled />`;
  summary.append(duration, effect, transition);
  container.append(summary);

  const texts = document.createElement("section");
  texts.className = "editor-section";
  texts.innerHTML = "<h5>Text</h5>";
  for (const item of textItems(slide)) {
    const label = document.createElement("label");
    label.className = "field-label";
    label.textContent = item.label;
    const area = document.createElement("textarea");
    area.className = "text-area timeline-text";
    area.rows = 3;
    area.dataset.kind = item.kind;
    area.dataset.index = String(item.index);
    area.value = item.text;
    label.append(area);
    texts.append(label);
  }
  if (texts.children.length === 1) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No text layers or captions.";
    texts.append(note);
  }
  container.append(texts);

  const images = document.createElement("section");
  images.className = "editor-section";
  images.innerHTML = "<h5>Images</h5>";
  for (const item of imageItems(slide)) {
    const row = document.createElement("div");
    row.className = "image-row";
    const pathEl = document.createElement("code");
    pathEl.textContent = `${item.label}: ${item.path}`;
    pathEl.dataset.kind = item.kind;
    pathEl.dataset.index = String(item.index);
    pathEl.dataset.path = item.path;
    const button = document.createElement("button");
    button.className = "secondary-button small-button";
    button.type = "button";
    button.textContent = "Replace";
    button.addEventListener("click", async () => {
      const result = await window.studio.chooseTimelineImage();
      if (result?.ok) {
        pathEl.dataset.path = result.path;
        pathEl.textContent = `${item.label}: ${result.path}`;
        showTimelineMessage(result.copied ? `Copied replacement to ${result.path}` : `Selected ${result.path}`, "ok");
      }
    });
    row.append(pathEl, button);
    images.append(row);
  }
  if (images.children.length === 1) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = "No editable images.";
    images.append(note);
  }
  container.append(images);
}

async function loadTimelineEditor() {
  showTimelineMessage("Loading timeline...");
  const result = await window.studio.readTimeline({ timelinePath: $("timelineEditorPath").value });
  if (!result?.ok) {
    showTimelineMessage(result?.message || "Could not load timeline.", "error");
    return;
  }
  currentTimeline = result.timeline;
  selectedSlideId = currentTimeline.slides?.[0]?.id || null;
  renderSlideList();
  renderSlideEditor();
  showTimelineMessage(`Loaded ${result.timelinePath}`, "ok");
}

async function saveSelectedSlide() {
  const slide = selectedSlide();
  if (!slide) {
    showTimelineMessage("No slide selected.", "error");
    return;
  }
  const textUpdates = [...document.querySelectorAll(".timeline-text")].map((el) => ({
    kind: el.dataset.kind,
    index: Number(el.dataset.index),
    text: el.value,
  }));
  const imageUpdates = [...document.querySelectorAll(".image-row code")].map((el) => ({
    kind: el.dataset.kind,
    index: Number(el.dataset.index),
    path: el.dataset.path,
  }));
  const result = await window.studio.writeTimeline({
    timelinePath: $("timelineEditorPath").value,
    slideId: slide.id,
    duration: $("editDuration")?.value,
    textUpdates,
    imageUpdates,
  });
  if (!result?.ok) {
    showTimelineMessage(result?.message || "Save failed.", "error");
    return;
  }
  currentTimeline = result.timeline;
  renderSlideList();
  renderSlideEditor();
  showTimelineMessage(`Saved ${slide.id} in ${result.timelinePath}`, "ok");
}

async function runPipelineStep(step, label) {
  setPipelineBusy(true);
  appendPipelineLog(`\n> ${label}`);
  try {
    const result = await window.studio.runPipeline(step, pipelinePayload());
    if (result.project) renderProject(result.project);
    const body = [result.stdout, result.stderr].filter(Boolean).join("\n");
    appendPipelineLog(body || "(no output)");
    appendPipelineLog(result.ok ? `OK: ${label} completed.` : `FAILED: ${label} failed with code ${result.code}.`);
  } catch (err) {
    appendPipelineLog(`FAILED: ${label} failed: ${err?.message || err}`);
  } finally {
    setPipelineBusy(false);
  }
}

async function refreshCatalog() {
  const catalog = await window.studio.assetCatalog();
  renderAssets(catalog);
}

async function init() {
  renderProject(await window.studio.currentProject());
  await refreshCatalog();
  $("chooseProject").addEventListener("click", async () => {
    const selected = await window.studio.chooseProject();
    if (selected) {
      renderProject(selected);
      await refreshCatalog();
    }
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });
  $("importAsset").addEventListener("click", async () => {
    showMessage("Choosing files...");
    const type = $("assetType").value;
    const result = await window.studio.importAssets(type);
    if (result?.canceled) {
      showMessage("Import canceled.");
      return;
    }
    if (!result?.ok) {
      showMessage(result?.message || "Import failed.", "error");
      return;
    }
    if (result.project) renderProject(result.project);
    showMessage(`Imported ${result.imported.length} file(s): ${result.imported.join(", ")}`, "ok");
  });
  $("analyzeAssets").addEventListener("click", async () => {
    showMessage("Analyzing assets...");
    $("analyzeAssets").disabled = true;
    try {
      const result = await window.studio.analyzeAssets();
      if (result.project) renderProject(result.project);
      renderAssets(result.catalog);
      showMessage(result.ok ? (result.stdout || "Asset catalog updated.") : (result.stderr || "Asset analysis failed."), result.ok ? "ok" : "error");
    } finally {
      $("analyzeAssets").disabled = false;
    }
  });
  $("chooseMusic").addEventListener("click", async () => {
    const result = await window.studio.chooseMusic();
    if (result?.ok) {
      $("musicPath").value = result.path;
      appendPipelineLog(result.copied ? `Copied music to ${result.path}` : `Selected ${result.path}`);
    }
  });
  $("analyzeInputs").addEventListener("click", () => runPipelineStep("analyze", "Analyze photos and music"));
  $("generateLite").addEventListener("click", () => runPipelineStep("generate", "Generate Lite timeline and fit text"));
  $("dryRunTimeline").addEventListener("click", () => runPipelineStep("dryRun", "Dry-run timeline"));
  $("timelinePath").addEventListener("input", () => {
    $("renderTimelinePath").value = $("timelinePath").value;
  });
  $("clearPipelineLog").addEventListener("click", () => {
    $("pipelineLog").textContent = "Ready.";
  });
  $("storyChoice").addEventListener("change", () => renderDirectorState(currentDirectorState));
  $("analyzeSemantics").addEventListener("click", () => runDirectorStep("semantics", "Analyze photo semantics"));
  $("generateOptions").addEventListener("click", () => runDirectorStep("options", "Generate story options"));
  $("generateNotes").addEventListener("click", () => runDirectorStep("notes", "Generate director notes"));
  $("generatePlan").addEventListener("click", () => runDirectorStep("plan", "Generate story plan"));
  $("generateDirectorTimeline").addEventListener("click", () => runDirectorStep("timeline", "Generate director-aware timeline"));
  $("clearDirectorLog").addEventListener("click", () => {
    $("directorLog").textContent = "Ready.";
  });
  $("loadTimeline").addEventListener("click", loadTimelineEditor);
  $("saveSlide").addEventListener("click", saveSelectedSlide);
  $("startRender").addEventListener("click", async () => {
    appendRenderLog(`\n> Start render: ${renderPayload().timelinePath}`);
    const result = await window.studio.startRender(renderPayload());
    if (!result?.ok) appendRenderLog(`FAILED: ${result?.message || "Could not start render."}`);
  });
  $("cancelRender").addEventListener("click", async () => {
    const result = await window.studio.cancelRender();
    appendRenderLog(result?.ok ? "Cancel requested." : `Cancel failed: ${result?.message || "No active render."}`);
  });
  $("openRenderOutput").addEventListener("click", async () => {
    const result = await window.studio.openRenderOutput();
    appendRenderLog(result?.ok ? `Opened output: ${result.path}` : `Open output failed: ${result?.message || "No output."}`);
  });
  $("clearRenderLog").addEventListener("click", () => {
    $("renderLog").textContent = "Ready.";
    resetRenderProgress();
  });
  window.studio.onRenderEvent((event) => {
    if (event.type === "start") {
      setRenderBusy(true);
      resetRenderProgress();
      setRenderProgress({ percent: 1, phase: "Starting render" });
      appendRenderLog(`Rendering ${event.timelinePath}${event.outputPath ? ` -> ${event.outputPath}` : ""}`);
      return;
    }
    if (event.type === "log") {
      appendRenderLog(event.text.trimEnd());
      updateRenderProgressFromLog(event.text);
      return;
    }
    if (event.type === "error") {
      setRenderBusy(false);
      $("renderStatus").className = "status-pill warning";
      $("renderStatus").textContent = "Failed";
      appendRenderLog(`FAILED: ${event.message}`);
      return;
    }
    if (event.type === "exit") {
      setRenderBusy(false);
      $("renderStatus").className = `status-pill ${event.ok ? "ready" : "warning"}`;
      $("renderStatus").textContent = event.ok ? "Done" : "Failed";
      setRenderProgress({ percent: event.ok ? 100 : renderProgress.percent, phase: event.ok ? "Complete" : "Failed" });
      if (event.project) renderProject(event.project);
      appendRenderLog(event.ok ? `OK: Render finished. Output: ${event.outputPath || "(unknown)"}` : `FAILED: Render exited with code ${event.code}.`);
    }
  });
}

init().catch((err) => {
  $("projectName").textContent = "Could not load project";
  $("projectPath").textContent = err?.message || String(err);
});
