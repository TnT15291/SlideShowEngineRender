import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { callDeepSeekJSON, hasKey, provenance, str, oneOf } from "./lib/deepseek.mjs";

const project = loadProject(arg("--project"));
const language = project.manifest.language || "vi";
const languageName = language === "en" ? "English" : "Vietnamese";
const read = (p) => JSON.parse(fs.readFileSync(project.abs(p), "utf8"));
const promptRel = project.manifest.promptFile || "prompt.txt";
const prompt = fs.readFileSync(project.abs(promptRel), "utf8").trim();
if (!prompt) throw new Error(`Prompt is empty: ${project.abs(promptRel)}`);

const selectedRel = project.manifest.selectedPhotos || "analysis/photos.selected.json";
const photosRel = fs.existsSync(project.abs(selectedRel)) ? selectedRel : `${project.manifest.analysisDir}/photos.json`;
const photos = read(photosRel).photos || [];
const contentPath = `${project.manifest.analysisDir}/photo_content.json`;
const content = fs.existsSync(project.abs(contentPath)) ? read(contentPath).photos || [] : [];
const musicRel = (project.manifest.music || [])[0];
const music = musicRel ? read(`${project.manifest.analysisDir}/music/${path.parse(musicRel).name}.json`) : null;
const moods = new Set(["calm", "warm", "build", "peak", "tender"]);
const sceneKinds = new Set(["single", "montage"]);

function fallback() {
  const sentences = prompt.split(/(?<=[.!?])\s+|\r?\n+/).map((s) => s.trim()).filter(Boolean);
  const headings = language === "en"
    ? ["Opening", "First Meeting", "Together", "Our Journey", "The Wedding Day", "Thank You"]
    : ["Mở đầu", "Gặp gỡ", "Bên nhau", "Hành trình", "Ngày chung đôi", "Lời cảm ơn"];
  const beats = sentences.slice(0, 8).map((body, i) => ({
    heading: headings[Math.min(i, headings.length - 1)], body,
    emotion: i === 0 ? "calm" : i === sentences.length - 1 ? "tender" : "warm",
    sceneKind: i > 0 && i % 2 === 0 ? "montage" : "single",
  }));
  while (beats.length < 3) beats.push({ heading: headings[beats.length], body: prompt, emotion: "warm", sceneKind: "single" });
  return { title: sentences[0]?.replace(/[.!?]+$/, "").slice(0, 100) || project.manifest.name, beats, closing: beats.at(-1).body };
}

let raw = fallback();
if (hasKey()) {
  const photoMenu = photos.map((p) => {
    const semantic = content.find((x) => x.file === p.file) || {};
    return { file: p.file, orient: p.orient, quality: p.qualityNorm, tags: semantic.tags || [], emotion: semantic.emotion || "unknown", heroScore: semantic.heroScore };
  });
  raw = await callDeepSeekJSON({
    temperature: 0.45,
    system: `You are a slideshow story editor. Return one JSON object with title, closing, and beats (3..10). Each beat has heading, body, emotion (calm|warm|build|peak|tender), sceneKind (single|montage), and optional preferredPhotos containing only exact file strings from the supplied photo menu. Do not output durations, paths outside the menu, effects, transitions, or pixel geometry. Shape the emotional arc to the music sections and the user's prompt. Write every viewer-visible string in ${languageName} only.`,
    user: JSON.stringify({ language, prompt, music: music ? { duration: music.duration, bpmEstimate: music.bpmEstimate, sections: music.sections, buildWindows: music.buildWindows } : null, photos: photoMenu }),
  });
}

const validFiles = new Set(photos.map((p) => p.file));
const sourceBeats = Array.isArray(raw.beats) ? raw.beats : [];
const beats = sourceBeats.slice(0, 10).map((b, i) => ({
  heading: str(b?.heading, 80) || `Phần ${i + 1}`,
  body: str(b?.body, 320),
  emotion: oneOf(b?.emotion, moods, "warm"),
  sceneKind: oneOf(b?.sceneKind, sceneKinds, "single"),
  preferredPhotos: Array.isArray(b?.preferredPhotos) ? [...new Set(b.preferredPhotos.filter((f) => validFiles.has(f)))].slice(0, 8) : [],
})).filter((b) => b.body);
if (beats.length < 3) beats.push(...fallback().beats.slice(beats.length, 3));

const story = {
  version: 1,
  language,
  generatedAt: new Date().toISOString(),
  generatedBy: provenance(),
  source: project.rel(promptRel),
  musicDuration: music?.duration || null,
  title: str(raw.title, 100) || fallback().title,
  beats,
  closing: str(raw.closing, 240) || beats.at(-1).body,
};
const storyRel = project.manifest.story || "analysis/story-template.generated.json";
const out = project.abs(storyRel);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(story, null, 2) + "\n");
console.log(`Wrote ${project.rel(storyRel)}: ${beats.length} beat(s), ${story.generatedBy}.`);
