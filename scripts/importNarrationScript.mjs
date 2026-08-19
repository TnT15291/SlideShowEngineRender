/**
 * Turn a narration script written in Markdown into `script/script.json`.
 *
 *   node scripts/importNarrationScript.mjs --project <dir> --source <markdown>
 *                                          [--config <json>] [--force]
 *
 * The source file carries its own film: an optional JSON front-matter block for
 * the metadata, `#` for the film title, and one `##` heading per section. Every
 * editorial decision that used to be a constant in this file is now data, so a
 * second film needs no code change — that is the whole point of the rewrite.
 *
 *     ---
 *     { "issuer": "Xã Lao Bảo, tỉnh Quảng Trị",
 *       "closingSlogan": "AN NINH TỪ NHÂN DÂN" }
 *     ---
 *
 *     # Toàn dân bảo vệ an ninh Tổ quốc - Lao Bảo 2026
 *
 *     ## AN NINH TỪ NHÂN DÂN {#mo-dau}
 *
 *     Đoạn văn thứ nhất…
 *
 * Front-matter is JSON rather than YAML on purpose: these scripts are Vietnamese
 * prose full of quotes and diacritics, and `JSON.parse` has one unambiguous
 * answer for all of it where a hand-rolled mini-YAML has several.
 */
import fs from "node:fs";
import path from "node:path";
import { arg, loadProject, slug } from "./lib/project.mjs";

function splitLongClause(text, limit) {
  const words = text.trim().split(/\s+/);
  const chunks = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > limit) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Cut a paragraph into beats of roughly `target` characters.
 *
 * Sentence boundaries first, then clause boundaries, then raw word count — so a
 * beat breaks where a reader would draw breath, and only falls back to a blunt
 * cut when one sentence is longer than `hardLimit` all by itself.
 *
 * CHANGING target/hardLimit INVALIDATES EVERY CACHED TTS LINE. The cache is
 * keyed on the beat text (see synthesizeNarration.mjs), so re-cutting a script
 * re-synthesises the whole film. Decide the numbers for a project before its
 * first synthesis run, not after.
 */
export function splitNarration(paragraph, target = 280, hardLimit = 380) {
  const sentences = paragraph.trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  const units = sentences.flatMap((sentence) => {
    if (sentence.length <= hardLimit) return [sentence];
    return sentence.split(/(?<=[,;:])\s+/u).flatMap((clause) =>
      clause.length <= hardLimit ? [clause] : splitLongClause(clause, target));
  });
  const chunks = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (current && candidate.length > target) {
      chunks.push(current.trim());
      current = unit;
    } else current = candidate;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Peel a `---` fenced JSON block off the top of the document.
 *
 * Returns the parsed object and the prose that follows. A malformed block is an
 * error rather than a silent skip: the alternative is a film that renders with
 * every default silently in place of the settings the writer thought they set.
 */
export function parseFrontMatter(text) {
  const match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { config: {}, body: text };
  try {
    const config = JSON.parse(match[1]);
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("front-matter must be a JSON object");
    }
    return { config, body: text.slice(match[0].length) };
  } catch (error) {
    throw new Error(`Invalid JSON front-matter: ${error.message}`);
  }
}

/**
 * Split the prose into sections on `##` headings.
 *
 * A heading may pin its own id with the usual `{#custom-id}` suffix; otherwise
 * the id is the slug of the heading text. Only equality of the id matters
 * downstream — it decides where a section dissolve and its breath go — so the
 * pinned form exists for stable references (a pool map, a review sheet), not
 * because the generated one would render differently.
 */
export function parseSections(body) {
  const lines = body.split(/\r?\n/);
  const sections = [];
  let documentTitle = "";
  let current = null;
  let buffer = [];

  const flush = () => {
    if (!current) return;
    current.paragraphs = buffer
      .join("\n")
      .split(/(?:\r?\n){2,}/)
      .map((value) => value.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    sections.push(current);
    buffer = [];
  };

  for (const line of lines) {
    const h1 = line.match(/^#[ \t]+(.+?)[ \t]*$/);
    const h2 = line.match(/^##[ \t]+(.+?)[ \t]*$/);
    if (h2) {
      flush();
      let title = h2[1].trim();
      let id = "";
      const pinned = title.match(/\s*\{#([a-z0-9-]+)\}$/i);
      if (pinned) {
        id = pinned[1].toLowerCase();
        title = title.slice(0, pinned.index).trim();
      }
      current = { id: id || slug(title), title, paragraphs: [] };
      continue;
    }
    if (h1 && !current) {
      documentTitle = h1[1].trim();
      continue;
    }
    if (current) buffer.push(line);
    else if (line.trim()) {
      throw new Error(
        `Prose appears before the first "## " section heading: "${line.trim().slice(0, 60)}". ` +
          "Every paragraph must belong to a section, so add a heading above it.",
      );
    }
  }
  flush();

  if (!sections.length) throw new Error('No sections found — the script needs at least one "## " heading.');
  const seen = new Map();
  for (const section of sections) {
    if (!section.id) throw new Error(`Section "${section.title}" has no usable id; pin one with {#an-id}.`);
    if (seen.has(section.id)) {
      throw new Error(`Two sections share the id "${section.id}" ("${seen.get(section.id)}" and "${section.title}"); pin distinct ids with {#an-id}.`);
    }
    seen.set(section.id, section.title);
    if (!section.paragraphs.length) throw new Error(`Section "${section.title}" has no paragraphs.`);
  }
  return { documentTitle, sections };
}

const DEFAULT_REVIEW_NOTES = [
  "Ký duyệt toàn bộ số liệu, tên đơn vị và mốc thời gian trước khi tổng hợp giọng.",
  "Kiểm tra các cụm nhận dạng bất thường do chuyển lời nói thành văn bản.",
  "Mỗi beat có visual.kind=pending phải được thay bằng ảnh hoặc clip thật đã kiểm kê.",
];

function positive(value, field, { min = 0, max = Infinity, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${field} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}; got ${JSON.stringify(value)}`);
  }
  return number;
}

/**
 * Accepts either { "id": { "pools": [...] } } or the shorthand { "id": [...] },
 * because a mapping whose values are all one key reads better without it.
 */
function normalizeSectionPools(sections) {
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) return {};
  const result = {};
  for (const [id, value] of Object.entries(sections)) {
    const pools = Array.isArray(value) ? value : value?.pools;
    if (Array.isArray(pools) && pools.length) result[id] = pools.map(String);
  }
  return result;
}

export function resolveConfig(config, documentTitle) {
  const name = String(config.name || documentTitle || "").trim();
  if (!name) {
    throw new Error('The film needs a name: add "name" to the front-matter, or a "# Title" heading at the top of the script.');
  }
  const beat = config.beat || {};
  const target = positive(beat.target ?? 280, "beat.target", { min: 40, max: 2000, integer: true });
  const hardLimit = positive(beat.hardLimit ?? Math.round(target * 1.36), "beat.hardLimit", { min: target, max: 4000, integer: true });
  const voice = config.voice || {};
  return {
    name,
    issuer: String(config.issuer || "").trim(),
    width: positive(config.width ?? 1920, "width", { min: 16, max: 7680, integer: true }),
    height: positive(config.height ?? 1080, "height", { min: 16, max: 4320, integer: true }),
    fps: positive(config.fps ?? 30, "fps", { min: 1, max: 120 }),
    quality: String(config.quality || "high"),
    output: String(config.output || `output/${slug(name) || "narrated"}.mp4`),
    // Both are re-checked by buildNarratedTimeline; checked here too so a typo
    // fails at import instead of after a TTS run that costs real minutes.
    maxShotDuration: positive(config.maxShotDuration ?? 9, "maxShotDuration", { min: 4, max: 28 }),
    closingDuration: positive(config.closingDuration ?? 4, "closingDuration", { min: 2, max: 30 }),
    closingSlogan: String(config.closingSlogan || "").trim(),
    sectionPause: positive(config.sectionPause ?? 1.2, "sectionPause", { min: 0, max: 10 }),
    title: config.title && typeof config.title === "object" ? config.title : null,
    // section id -> pool names, in preference order. Validated against the
    // album's real pools by assignNarrationVisuals.mjs, not here: this module
    // never reads the analysis directory and must not pretend to know it.
    sectionPools: normalizeSectionPools(config.sections),
    tier: String(config.tier || "lite"),
    inputDir: String(config.inputDir || "photos"),
    timeline: String(config.timeline || `timeline/${slug(name) || "narrated"}.json`),
    reviewNotes: Array.isArray(config.reviewNotes) && config.reviewNotes.length ? config.reviewNotes.map(String) : DEFAULT_REVIEW_NOTES,
    beat: { target, hardLimit },
    voice: {
      provider: String(voice.provider || "vieneu"),
      voice: String(voice.voice || "Phạm Tuyên"),
      style: String(voice.style || "tin_tuc"),
      speed: Number(voice.speed ?? 0),
      leadingSilence: positive(voice.leadingSilence ?? 0.8, "voice.leadingSilence", { min: 0, max: 10 }),
      defaultPause: positive(voice.defaultPause ?? 0.45, "voice.defaultPause", { min: 0, max: 10 }),
    },
    music: Array.isArray(config.music) ? config.music : [],
  };
}

/** Build the beat list. Exported so the shaping rules can be tested without a project on disk. */
export function buildBeats(sections, settings) {
  // Annotated because `pauseAfter` is attached in the second pass below, after
  // the whole list exists — checkJs infers the literal's shape at push time.
  const beats = /** @type {any[]} */ ([]);
  for (const section of sections) {
    for (const paragraph of section.paragraphs) {
      for (const narration of splitNarration(paragraph, settings.beat.target, settings.beat.hardLimit)) {
        const id = `b${String(beats.length + 1).padStart(3, "0")}`;
        const firstInSection = !beats.some((beat) => beat.section === section.id);
        beats.push({
          id,
          section: section.id,
          narration,
          ...(firstInSection ? { caption: section.title } : {}),
          visual: beats.length === 0 && settings.title
            ? { kind: "title", title: settings.title.title || settings.name, subtitle: settings.title.subtitle || "" }
            : { kind: "pending", description: `Chưa gán tư liệu cho ${id}; cần ảnh hoặc subclip thật có mốc nguồn rõ ràng.` },
        });
      }
    }
  }
  // The long breath belongs to the beat that CLOSES a section, not the one that
  // opens the next: the pause has to sit in the gap the section dissolve lands
  // in. The default 1.2s also outlasts the 1.0s `fade_slow`, so that dissolve
  // finishes entirely in silence instead of over the first words of the new
  // section — keep that relationship in mind before lowering sectionPause.
  if (settings.sectionPause > 0) {
    for (const [index, beat] of beats.entries()) {
      const next = beats[index + 1];
      if (next && next.section !== beat.section) beat.pauseAfter = settings.sectionPause;
    }
  }
  return beats;
}

/** Assemble the whole script object. Kept separate from disk I/O so it can be tested directly. */
export function buildScript(raw, sidecar = {}) {
  const { config: frontMatter, body } = parseFrontMatter(raw);
  const { documentTitle, sections } = parseSections(body);
  const settings = resolveConfig({ ...frontMatter, ...sidecar }, documentTitle);
  const beats = buildBeats(sections, settings);
  if (!beats.length) throw new Error("The script produced no beats.");
  return {
    body,
    settings,
    script: {
      version: 1,
      reviewStatus: "needs-content-approval",
      reviewNotes: settings.reviewNotes,
      project: {
        name: settings.name,
        issuer: settings.issuer,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        quality: settings.quality,
        output: settings.output,
        maxShotDuration: settings.maxShotDuration,
        closingDuration: settings.closingDuration,
        closingSlogan: settings.closingSlogan,
      },
      // Sections were previously only recoverable by scanning every beat. Naming
      // them once is what lets the front-matter say which pools of photographs a
      // section draws from, which is the whole input to the visual assigner.
      sections: sections.map((section) => ({
        id: section.id,
        title: section.title,
        ...(settings.sectionPools[section.id] ? { pools: settings.sectionPools[section.id] } : {}),
      })),
      voice: settings.voice,
      music: settings.music,
      beats,
    },
  };
}

function main() {
  const project = loadProject(arg("--project"));
  const sourceArg = arg("--source");
  if (!sourceArg) {
    throw new Error("Usage: node scripts/importNarrationScript.mjs --project <dir> --source <markdown> [--config <json>] [--force]");
  }
  const source = path.resolve(sourceArg);
  if (!fs.existsSync(source)) throw new Error(`Source script not found: ${source}`);

  const configArg = arg("--config");
  // A sidecar wins over front-matter so a writer who cannot be asked to embed
  // JSON can still hand over a plain .md and have the settings live elsewhere.
  const sidecar = configArg ? JSON.parse(fs.readFileSync(path.resolve(configArg), "utf8")) : {};
  const { body, settings, script } = buildScript(fs.readFileSync(source, "utf8"), sidecar);

  const scriptDir = path.join(project.dir, "script");
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, "script.json");
  // Assigning a visual to every beat is days of human work that lives ONLY in
  // this file. A re-import must never quietly eat it.
  if (fs.existsSync(scriptPath) && !process.argv.includes("--force")) {
    const existing = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
    const assigned = (existing.beats || []).filter((beat) =>
      [beat.visual, ...(beat.visuals || [])].some((visual) => visual && visual.kind !== "pending")).length;
    throw new Error(
      `${scriptPath} already exists (${existing.beats?.length ?? 0} beats, ${assigned} with visuals assigned). ` +
        "Re-importing rebuilds beats from the markdown and discards every visual assignment, caption and review status. " +
        "Edit script.json directly, or pass --force if you really mean to start over.",
    );
  }
  fs.writeFileSync(path.join(scriptDir, "script.md"), `${body.trim()}\n`, "utf8");
  fs.writeFileSync(scriptPath, `${JSON.stringify(script, null, 2)}\n`, "utf8");
  for (const dir of [settings.inputDir, "footage/raw", "footage/clips", "voice/cache", "voice/lines"]) {
    fs.mkdirSync(path.join(project.dir, dir), { recursive: true });
    fs.writeFileSync(path.join(project.dir, dir, ".gitkeep"), "", "utf8");
  }
  const catalogPath = path.join(project.dir, "footage", "footage.json");
  if (!fs.existsSync(catalogPath)) fs.writeFileSync(catalogPath, '{\n  "version": 1,\n  "clips": []\n}\n', "utf8");

  const manifestPath = path.join(project.dir, "project.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.inputDir = settings.inputDir;
  manifest.timeline = settings.timeline;
  manifest.output = settings.output;
  manifest.tier = settings.tier;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `Imported ${script.beats.length} narration beats across ${script.sections.length} section(s). ` +
      "Review gate remains closed until content and visual assignments are approved.",
  );
}

// Importing this module for its parsers must not run the CLI.
if (process.argv[1] && path.resolve(process.argv[1]).endsWith("importNarrationScript.mjs")) main();
