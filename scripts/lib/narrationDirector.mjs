/**
 * The director: read the script, look at what footage exists, and say which
 * picture belongs to which sentence — and why.
 *
 * This is the half of the narrated pipeline that holds an opinion. It replaces
 * nothing about how a film is built; it only decides what goes where, and it
 * writes that decision into a review file for a person to sign rather than
 * straight into the script.
 *
 * NOTHING HERE TALKS TO A MODEL. Prompt building and answer checking are pure
 * functions so both can be tested without a key, a network, or a bill —
 * scripts/proposeNarrationVisuals.mjs is the part that makes the call.
 *
 * The checking is not belt-and-braces. JSON mode nudges a model toward JSON and
 * enforces nothing else, so every field comes back onto the contract here:
 * indices that do not exist, a photograph spent twice, a beat left out, a
 * landscape motion written onto a tall photograph, a clip too short for its
 * slide. Each of those either stops the build outright or is visible in the
 * finished film, and each is repaired here — loudly, into `repairs`, so the
 * review file shows a person exactly where the model slipped.
 */

import { LANDSCAPE_EFFECTS, PORTRAIT_EFFECT } from "./visualAssigner.mjs";

/** Every motion a photograph may carry. The model is held to this list. */
export const ALLOWED_EFFECTS = [...LANDSCAPE_EFFECTS, PORTRAIT_EFFECT];

const MAX_REASON = 240;

/**
 * Describe the film to the model.
 *
 * Beats carry their words, their section, how many pictures the window holds
 * and how long it runs — a director who cannot see the clock will happily hang
 * one photograph on eleven seconds of speech.
 */
export function buildDirectorPrompt({ beats, photos, clips = [], filmName = "", issuer = "" }) {
  const system = [
    "You are a documentary picture editor working in Vietnamese.",
    "You are given the narration of a film, beat by beat, and an inventory of photographs and video clips.",
    "For EVERY beat you must choose exactly the number of visuals it asks for, in the order they will appear.",
    "",
    "Choose on MEANING: the picture must show what the sentence is talking about. A beat about fire drills",
    "takes a fire-drill photograph, not a generic meeting. When nothing in the inventory shows the subject,",
    "choose the closest thing from the same pool and say so plainly in `why`.",
    "",
    "Rules you must not break:",
    "  - use each photograph AT MOST ONCE in the whole film;",
    "  - `photo` refers to an index from the PHOTOGRAPHS list, `clip` to an index from the CLIPS list;",
    `  - effect must be one of: ${ALLOWED_EFFECTS.join(", ")};`,
    `  - a portrait or square photograph must use ${PORTRAIT_EFFECT}, never a panning or zooming motion;`,
    "  - do not put the same motion on two consecutive visuals;",
    "  - a clip may only be used where its duration covers the whole slide.",
    "",
    "`why` is one short Vietnamese sentence saying what in the picture matches what in the sentence.",
    "It is read by a person deciding whether to keep your choice, so justify the MATCH, not the aesthetics.",
    'Return one JSON object of the form {"beats":[{"id":"b001","picks":[{"kind":"photo","index":12,"effect":"pan_right","why":"..."}]}]}.',
    "No commentary, no file paths, no extra fields.",
  ].join("\n");

  const photoLines = photos.map((photo) =>
    `${photo.index}\t${photo.pool ?? "-"}\t${photo.orient ?? "?"}\t${photo.caption ?? ""}`.trimEnd());
  const clipLines = clips.map((clip) => `${clip.index}\t${clip.duration.toFixed(1)}s\t${clip.label ?? ""}`.trimEnd());
  // Both numbers: "3 visuals, 6.6s" reads as three pictures crammed into six
  // seconds when it means three pictures of six seconds each.
  const beatLines = beats.map((beat) =>
    `${beat.id}\t[${beat.section}]\tneeds ${beat.needs} visual(s), ${beat.seconds.toFixed(1)}s each (${(beat.seconds * beat.needs).toFixed(1)}s total)\n  ${beat.narration}`);

  const user = [
    filmName ? `FILM: ${filmName}${issuer ? ` — ${issuer}` : ""}` : "",
    "",
    "PHOTOGRAPHS (index, pool, orientation, description):",
    ...photoLines,
    "",
    clipLines.length ? "CLIPS (index, duration, description):" : "CLIPS: none available.",
    ...clipLines,
    "",
    "NARRATION:",
    ...beatLines,
    "",
    `Return the JSON object now, with one entry for each of these ${beats.length} beats.`,
  ].filter((line) => line !== null).join("\n");

  return { system, user };
}

/** A deterministic answer shaped like the model's, for running without a key. */
export function stubProposal(beats) {
  return {
    beats: beats.map((beat) => ({
      id: beat.id,
      // Deliberately empty: a stub that invented picks would look like a working
      // director and quietly ship an unreviewed film. Empty means the fallback
      // assigner fills every slot, and the review file says so.
      picks: [],
    })),
  };
}

function isPortrait(photo) {
  return photo?.orient === "portrait" || photo?.orient === "square";
}

/**
 * Bring the model's answer back onto the contract.
 *
 * Returns one entry per beat in the order given — never more, never fewer — plus
 * a `repairs` list naming every correction, because a silent repair is a lie
 * told to whoever signs the review file.
 */
export function validateProposal(raw, { beats, photos, clips = [] }) {
  const repairs = [];
  const byId = new Map();
  for (const entry of Array.isArray(raw?.beats) ? raw.beats : []) {
    if (entry && typeof entry.id === "string" && !byId.has(entry.id)) byId.set(entry.id, entry);
  }

  // Look up by the index the PROMPT showed, not by position in this array.
  // The caller offers only photographs some pool vouches for — 213 of the ANTT
  // album's 339 — while the indices in the prompt stay the album's own. Indexing
  // the filtered array by an album index silently returns a DIFFERENT
  // photograph, which is the one failure here that no gate downstream can see:
  // the film builds perfectly and shows the wrong picture.
  const photoAt = new Map(photos.map((photo, position) => [photo.index ?? position, photo]));
  const clipAt = new Map(clips.map((clip, position) => [clip.index ?? position, clip]));

  const usedPhotos = new Set();
  const usedClips = new Set();
  const result = [];
  let previousEffect = "";
  let previousClip = "";

  for (const beat of beats) {
    const entry = byId.get(beat.id);
    if (!entry) repairs.push(`${beat.id}: the director returned nothing for this beat.`);
    const proposed = Array.isArray(entry?.picks) ? entry.picks : [];
    const picks = [];

    for (const pick of proposed) {
      if (picks.length >= beat.needs) {
        repairs.push(`${beat.id}: more visuals proposed than the ${beat.seconds.toFixed(1)}s window holds; dropped the extras.`);
        break;
      }
      const index = Number(pick?.index);
      const why = typeof pick?.why === "string" ? pick.why.trim().slice(0, MAX_REASON) : "";

      if (pick?.kind === "clip") {
        const clip = clipAt.get(index);
        if (!clip) { repairs.push(`${beat.id}: clip index ${pick?.index} does not exist.`); continue; }
        if (usedClips.has(clip.file)) { repairs.push(`${beat.id}: clip "${clip.label ?? clip.file}" was already used.`); continue; }
        // The builder throws on this, hours into a run. Catch it while a person
        // is still looking at the review file.
        if (clip.duration + 0.001 < beat.seconds) {
          repairs.push(`${beat.id}: clip "${clip.label ?? clip.file}" is ${clip.duration.toFixed(1)}s but the slide runs ${beat.seconds.toFixed(1)}s.`);
          continue;
        }
        if (clip.file === previousClip) { repairs.push(`${beat.id}: the same clip would run across two consecutive slides.`); continue; }
        usedClips.add(clip.file);
        previousClip = clip.file;
        previousEffect = "";
        picks.push({ kind: "clip", src: clip.file, label: clip.label ?? "", why, verdict: "pending", chosenBy: "director" });
        continue;
      }

      const photo = photoAt.get(index);
      if (!photo) { repairs.push(`${beat.id}: photo index ${pick?.index} does not exist.`); continue; }
      if (usedPhotos.has(photo.file)) { repairs.push(`${beat.id}: "${photo.file}" was already used earlier in the film.`); continue; }

      let effect = typeof pick?.effect === "string" ? pick.effect : "";
      if (!ALLOWED_EFFECTS.includes(effect)) {
        repairs.push(`${beat.id}: "${effect || "(none)"}" is not a motion this engine has; replaced.`);
        effect = "";
      }
      if (isPortrait(photo)) {
        // Not a matter of taste: a tall photograph under a panning motion sits
        // between two black bars for the whole slide.
        if (effect && effect !== PORTRAIT_EFFECT) repairs.push(`${beat.id}: "${photo.file}" is ${photo.orient}; forced ${PORTRAIT_EFFECT}.`);
        effect = PORTRAIT_EFFECT;
      } else if (!effect || effect === PORTRAIT_EFFECT || effect === previousEffect) {
        if (effect === previousEffect && effect) repairs.push(`${beat.id}: the same motion twice in a row; varied it.`);
        effect = LANDSCAPE_EFFECTS.find((candidate) => candidate !== previousEffect) ?? LANDSCAPE_EFFECTS[0];
      }

      usedPhotos.add(photo.file);
      previousEffect = effect;
      previousClip = "";
      picks.push({ kind: "photo", src: photo.file, pool: photo.pool, photoIndex: index, effect, why, verdict: "pending", chosenBy: "director" });
    }

    if (picks.length < beat.needs) {
      repairs.push(`${beat.id}: ${picks.length}/${beat.needs} visual(s) chosen; the rest will be filled by the fallback assigner.`);
    }
    result.push({ ...beat, picks });
  }

  return { beats: result, repairs, usedPhotos, usedClips };
}
