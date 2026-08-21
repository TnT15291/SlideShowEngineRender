/**
 * What `narration:build` would do to this project, and why — decided without doing it.
 *
 * The narrated pipeline is eight commands run in order, and the whole difficulty is
 * that two of them SPEND: synthesis costs real minutes of text-to-speech (and its
 * cache is keyed on the words, so a beat that changes is paid for again), and the
 * render costs an encode. So the gates that can be checked for free — is the content
 * signed off, do the declared pools exist, is the music where the script says it is —
 * are checked HERE, before the first expensive step, rather than being discovered by
 * a script that has already been running for four minutes.
 *
 * Nothing in this file writes, spawns or measures. It reads the project and returns an
 * ordered list of decisions, which is what makes `--dry-run` an honest preview of the
 * run and what lets the tests cover every gate without ffmpeg or a TTS key.
 *
 * Re-runnable by mtime, exactly like lib/resumeProject.mjs: a step whose output is
 * newer than its inputs is skipped, and because the caller re-plans after each step it
 * executes, a rebuilt narration.json makes the timeline plan itself as `run` without
 * anything having to remember that it did.
 */
import fs from "node:fs";
import path from "node:path";

import { hasAuthoredVisual } from "./visualAssigner.mjs";
import { listPhotoFiles, resolvePoolsFile } from "./photoIndex.mjs";

const SCRIPT = "script/script.json";
const NARRATION = "voice/narration.json";
const NARRATION_WAV = "voice/narration.wav";
const REVIEW = "script/visual-review.json";

/** A step the runner performs itself rather than by spawning a script. */
export const INTERNAL_PHOTO_INDEX = "photo-index";

function mtimeOf(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

function readJsonAt(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

/**
 * Does this narration say what the script now says?
 *
 * The same four things the synthesizer keys its cache on — the words, the provider, the
 * voice and the speed — plus the beat ids, because the timeline hangs pictures on them.
 * Everything else in script.json (a caption, a picture, a review note) can change all it
 * likes without a syllable of the film needing to be spoken again.
 */
export function narrationMatchesScript(script, narration) {
  if (!narration) return { matches: false, reason: "synthesize the narration" };
  const segments = Array.isArray(narration.segments) ? narration.segments : [];
  if (segments.length !== script.beats.length) {
    return { matches: false, reason: `the script has ${script.beats.length} beats and the narration has ${segments.length}` };
  }
  const voice = script.voice || {};
  for (const [field, spoken] of [["provider", narration.provider], ["voice", narration.voice], ["style", narration.style]]) {
    if (voice[field] !== undefined && String(voice[field]) !== String(spoken)) {
      return { matches: false, reason: `the script asks for ${field} "${voice[field]}" and the narration was read with "${spoken}"` };
    }
  }
  if (voice.speed !== undefined && Number(voice.speed) !== Number(narration.speed)) {
    return { matches: false, reason: `the script asks for speed ${voice.speed} and the narration was read at ${narration.speed}` };
  }
  // `beat.narration` is the field the synthesizer reads and stores back as the segment's
  // text; `beat.text` does not exist. Comparing the wrong one makes every beat look
  // rewritten, and the voice is then re-made on every single run.
  const changed = script.beats.findIndex((beat, index) =>
    beat.id !== segments[index].id || String(beat.narration ?? "") !== String(segments[index].text ?? ""));
  if (changed >= 0) {
    return { matches: false, reason: `beat ${script.beats[changed].id} was rewritten after it was spoken` };
  }
  return { matches: true, reason: "" };
}

export function planNarratedBuild(project, options = {}) {
  const abs = (relative) => path.join(project.dir, relative);
  const exists = (relative) => Boolean(relative) && fs.existsSync(abs(relative));
  const mtime = (relative) => mtimeOf(abs(relative));
  const steps = [];
  const add = (step) => { steps.push(step); return step; };
  const stop = (id, reason) => ({ steps, blocked: add({ id, kind: "gate", action: "stop", reason }) });
  const projectArg = project.relDir;

  // ── the script ────────────────────────────────────────────────────────────
  if (!exists(SCRIPT)) {
    if (!options.source) {
      return stop("script", `${project.relDir}/${SCRIPT} does not exist yet and no --source was given. ` +
        "Point the build at the narration markdown: --source <script.md>");
    }
    add({
      id: "script", kind: "action", action: "run",
      reason: `import ${options.source}`,
      command: ["scripts/importNarrationScript.mjs", "--project", projectArg, "--source", options.source,
        ...(options.config ? ["--config", options.config] : [])],
    });
    // Everything below is decided by the file the import is about to write, so the
    // caller re-plans rather than guessing at it now.
    return { steps, blocked: null, pending: true };
  }
  add({
    id: "script", kind: "action", action: "skip",
    reason: options.source
      ? `${SCRIPT} already exists — re-importing rebuilds the beats from the markdown and discards every visual ` +
        "assignment and caption. Run narration:import --force yourself if that is what you mean."
      : `${SCRIPT} already imported`,
  });

  let script;
  try {
    script = JSON.parse(fs.readFileSync(abs(SCRIPT), "utf8"));
  } catch (error) {
    return stop("script", `${SCRIPT} is not readable JSON: ${error.message}`);
  }
  const beats = Array.isArray(script.beats) ? script.beats : [];
  if (!beats.length) return stop("script", `${SCRIPT} has no beats`);

  // ── the content gate ──────────────────────────────────────────────────────
  // First, because it is the gate a film is most often stopped by and the only one
  // whose answer is a person's signature. Meeting it after four minutes of synthesis
  // is how the first film came to be built with --allow-unapproved.
  const approved = script.reviewStatus === "approved";
  if (!approved && !options.allowUnapproved) {
    return stop("content-review", `Content review gate is "${script.reviewStatus || "missing"}". ` +
      `Sign off the facts and set "reviewStatus": "approved" in ${project.relDir}/${SCRIPT}, ` +
      "or pass --allow-unapproved for a disposable test cut that must never be delivered.");
  }
  add({
    id: "content-review", kind: "gate", action: "pass",
    reason: approved ? "content signed off" : "--allow-unapproved: this cut is a test, not a delivery master",
  });

  // ── the files the script names ────────────────────────────────────────────
  const pending = beats.filter((beat) => !hasAuthoredVisual(beat));
  const music = Array.isArray(script.music) ? script.music : [];
  const missingMusic = music.filter((track) => !exists(track?.path));
  if (missingMusic.length) {
    return stop("inputs", `${SCRIPT} names music that is not in the project: ` +
      `${missingMusic.map((track) => track?.path || "(no path)").join(", ")}`);
  }
  const inputDir = project.manifest.inputDir || "photos";
  let photoFiles = [];
  if (pending.length) {
    if (!exists(inputDir)) {
      return stop("inputs", `${pending.length} beat(s) still need pictures, but ${inputDir}/ does not exist`);
    }
    photoFiles = listPhotoFiles(abs(inputDir));
    if (!photoFiles.length) {
      return stop("inputs", `${pending.length} beat(s) still need pictures, but ${inputDir}/ holds none`);
    }
  }
  add({
    id: "inputs", kind: "gate", action: "pass",
    reason: pending.length
      ? `${music.length} music track(s), ${photoFiles.length} photograph(s) to draw on, ${pending.length} beat(s) still to fill`
      : `${music.length} music track(s); all ${beats.length} beats already have their pictures`,
  });

  // ── the album inventory ───────────────────────────────────────────────────
  const indexPath = "analysis/photo-index.json";
  if (!pending.length) {
    add({ id: "photo-index", kind: "action", action: "skip", reason: "every beat already carries its pictures" });
  } else if (exists(indexPath)) {
    let index;
    try {
      index = JSON.parse(fs.readFileSync(abs(indexPath), "utf8"));
    } catch (error) {
      return stop("photo-index", `${indexPath} is not readable JSON: ${error.message}`);
    }
    // The pools index into this array BY POSITION. A folder that has only grown keeps
    // every existing position, so that is a note; a folder whose order has changed
    // re-points every pool at a different photograph, and nothing downstream can see it.
    const drifted = index.findIndex((row, position) => row.file !== photoFiles[position]);
    if (drifted >= 0) {
      return stop("photo-index", `${indexPath} no longer describes ${inputDir}/ — position ${drifted} is ` +
        `"${index[drifted]?.file}" in the index and "${photoFiles[drifted] ?? "(nothing)"}" in the folder. ` +
        "Every pool indexes into this array by position, so rebuilding it would re-point them at other " +
        "photographs. Restore the folder, or re-tag the pools against a rebuilt index.");
    }
    add({
      id: "photo-index", kind: "action", action: "skip",
      reason: photoFiles.length > index.length
        ? `${indexPath} covers ${index.length} of ${photoFiles.length} photographs; the ` +
          `${photoFiles.length - index.length} newer ones belong to no pool`
        : `${indexPath} indexes ${index.length} photographs`,
    });
  } else {
    add({
      id: "photo-index", kind: "action", action: "run",
      reason: `measure the ${photoFiles.length} photographs in ${inputDir}/`,
      internal: INTERNAL_PHOTO_INDEX,
    });
  }

  // ── which pictures a section may draw on ──────────────────────────────────
  if (pending.length) {
    const sections = Array.isArray(script.sections) ? script.sections : [];
    // The same order the assigner reads them in, from the same list, so a gate that
    // passes here cannot be a file the next command refuses.
    const poolsFile = resolvePoolsFile(project.dir);
    if (!poolsFile) {
      return stop("pools", "No analysis/pools-curated.json or analysis/pools.json. The assigner draws from named " +
        'pools of photographs — a JSON object of "<pool>": [indices into analysis/photo-index.json]. ' +
        `Sections waiting on one: ${sections.map((section) => section.id).join(", ") || "(none declared)"}.`);
    }
    let pools;
    try {
      pools = JSON.parse(fs.readFileSync(abs(poolsFile), "utf8"));
    } catch (error) {
      return stop("pools", `${poolsFile} is not readable JSON: ${error.message}`);
    }
    const named = Object.keys(pools).filter((name) => !name.startsWith("_"));
    const declaring = sections.filter((section) => Array.isArray(section.pools) && section.pools.length);
    if (!declaring.length) {
      return stop("pools", 'No section says which pools it draws from. Add "sections": { "<id>": { "pools": [...] } } ' +
        `to the script front-matter and re-import. Available: ${named.join(", ") || "(none)"}`);
    }
    const unknown = [...new Set(declaring.flatMap((section) => section.pools))].filter((name) => !named.includes(name));
    if (unknown.length) {
      return stop("pools", `Section(s) name pool(s) ${poolsFile} does not have: ${unknown.join(", ")}. ` +
        `Available: ${named.join(", ")}`);
    }
    add({
      id: "pools", kind: "gate", action: "pass",
      reason: `${declaring.length}/${sections.length} section(s) draw from ${named.length} pool(s) in ${poolsFile}`,
    });
  }

  // ── the voice ─────────────────────────────────────────────────────────────
  // Judged on the WORDS, not on a timestamp. Assigning pictures rewrites script.json,
  // and an mtime rule reads that as "the script changed" and re-synthesizes a voice
  // that says exactly the same thing — on a 53-beat film, every line re-stitched and
  // re-measured for a change to a field the narrator never sees.
  const scriptTime = mtime(SCRIPT);
  const spoken = narrationMatchesScript(script, exists(NARRATION) ? readJsonAt(abs(NARRATION)) : null);
  const narrationFresh = spoken.matches && exists(NARRATION_WAV);
  add(narrationFresh
    ? { id: "narration", kind: "action", action: "skip", reason: `${NARRATION} already says these ${beats.length} beats` }
    : {
      id: "narration", kind: "action", action: "run",
      reason: exists(NARRATION) ? spoken.reason : "synthesize the narration",
      command: ["scripts/synthesizeNarration.mjs", "--project", projectArg,
        ...(options.allowUnapproved ? ["--allow-unapproved"] : [])],
    });

  // ── the pictures ──────────────────────────────────────────────────────────
  // How many pictures a stretch of script needs comes from how long it takes to read
  // aloud, so this can only be settled once narration.json exists. On the run that
  // synthesizes it, the decision is deferred to the re-plan rather than guessed.
  if (!pending.length) {
    add({ id: "visuals", kind: "action", action: "skip", reason: `all ${beats.length} beats carry their pictures` });
  } else if (!narrationFresh) {
    add({
      id: "visuals", kind: "action", action: "deferred",
      reason: `fill ${pending.length} beat(s) against the narration this run is about to produce`,
    });
  } else {
    const step = add(visualStep({ exists, abs, projectArg, pending, options }));
    // The one decision that can stop the build without being a gate of its own: a
    // proposal nobody signed. Blocking on it is the whole point of the review file.
    if (step.action === "stop") return { steps, blocked: step };
  }

  // ── the timeline ──────────────────────────────────────────────────────────
  const timelineRel = project.manifest.timeline || "timeline/timeline.json";
  const timelineFresh = narrationFresh && !pending.length && exists(timelineRel) &&
    mtime(timelineRel) >= scriptTime && mtime(timelineRel) >= mtime(NARRATION);
  add(timelineFresh
    ? { id: "timeline", kind: "action", action: "skip", reason: `${timelineRel} is newer than the script and the narration` }
    : {
      id: "timeline", kind: "action", action: "run",
      reason: "build the timeline against the narration's real durations",
      command: ["scripts/buildNarratedTimeline.mjs", "--project", projectArg,
        ...(options.allowUnapproved ? ["--allow-unapproved"] : [])],
    });
  add(timelineFresh
    ? { id: "text-fit", kind: "action", action: "skip", reason: "the timeline did not change" }
    : {
      id: "text-fit", kind: "action", action: "run",
      reason: "shrink any line of text that does not fit its box",
      command: ["scripts/fitTextInTimeline.mjs", project.rel(timelineRel),
        "--out", project.rel(`${project.manifest.analysisDir || "analysis"}/text-fit.json`)],
    });

  // ── the film ──────────────────────────────────────────────────────────────
  // The script's own output wins, because that is the one the timeline builder writes
  // into the timeline; the manifest's is the fallback the subtitle exporter uses.
  const outputRel = script.project?.output || project.manifest.output;
  if (options.render === false) {
    add({ id: "render", kind: "action", action: "skip", reason: "--no-render" });
  } else if (timelineFresh && exists(outputRel) && mtime(outputRel) >= mtime(timelineRel)) {
    add({ id: "render", kind: "action", action: "skip", reason: `${outputRel} is newer than the timeline` });
  } else {
    add({
      id: "render", kind: "action", action: "run",
      reason: `encode ${outputRel}`,
      command: ["--import", "tsx", "src/index.ts", "--timeline", project.rel(timelineRel), "--job-dir", projectArg],
    });
  }

  // ── the subtitles ─────────────────────────────────────────────────────────
  const srtRel = `${outputRel.replace(/\.[^./]+$/, "")}.srt`;
  add(narrationFresh && exists(srtRel) && mtime(srtRel) >= mtime(NARRATION)
    ? { id: "subtitles", kind: "action", action: "skip", reason: `${srtRel} is newer than the narration` }
    : {
      id: "subtitles", kind: "action", action: "run",
      reason: "write the subtitle file beside the film",
      command: ["scripts/exportNarrationSrt.mjs", "--project", projectArg],
    });

  return { steps, blocked: null };
}

/**
 * A director's proposal is a decision waiting on a person, so it is never stepped
 * around: an unsigned one stops the build rather than being quietly replaced by the
 * deterministic assigner's picks.
 */
function visualStep({ exists, abs, projectArg, pending, options }) {
  if (!exists(REVIEW)) {
    return {
      id: "visuals", kind: "action", action: "run",
      reason: `fill ${pending.length} beat(s) from the pools`,
      command: ["scripts/assignNarrationVisuals.mjs", "--project", projectArg, "--write",
        ...(options.allowUnapproved ? ["--allow-unapproved"] : [])],
    };
  }
  let review;
  try {
    review = JSON.parse(fs.readFileSync(abs(REVIEW), "utf8"));
  } catch (error) {
    return { id: "visuals", kind: "gate", action: "stop", reason: `${REVIEW} is not readable JSON: ${error.message}` };
  }
  if (review.approved !== true) {
    return {
      id: "visuals", kind: "gate", action: "stop",
      reason: `${REVIEW} is a director's proposal that nobody has signed. Read it, correct any pick you disagree ` +
        'with and set "approved": true — or delete it to let the deterministic assigner fill the film.',
    };
  }
  return {
    id: "visuals", kind: "action", action: "run",
    reason: `apply the approved review, and fill ${pending.length} beat(s) it left short`,
    command: ["scripts/applyNarrationVisuals.mjs", "--project", projectArg, "--write", "--fill"],
  };
}
