import { MAX_SCENE } from "./pacing.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The transition clamp this function itself applies (see the loop below). Exported so a
// caller sizing a target duration against `slides.length * MAX_SCENE` can account for the
// same overhead: a slide's `duration` field includes its outgoing transition, so N slides
// joined by real (non-"none") transitions cover less than N*MAX_SCENE of actual track time
// — each internal join gives back up to this many seconds. Getting this wrong is exactly
// what let the ceiling this module enforces be computed too optimistically upstream.
export const MAX_TRANSITION_SEC = 1.25;

function energyAt(music, time) {
  const section = (music.sections || []).find((item) => time >= item.start && time < item.end);
  return section?.kind || "normal";
}

function nearestBoundary(boundaries, wanted, min, max) {
  const candidates = boundaries.filter((time) => time >= min && time <= max);
  if (!candidates.length) return clamp(wanted, min, max);
  return candidates.reduce((best, time) => Math.abs(time - wanted) < Math.abs(best - wanted) ? time : best);
}

/**
 * Retimes an authored sequence to a music analysis. Scene order, renderer, effect and
 * transition type remain authored; only durations and transition overlap change.
 */
export function retimeSlidesToMusic(slides, music, options = {}) {
  if (!Array.isArray(slides) || !slides.length) throw new Error("retime needs at least one slide");
  if (!(Number(music?.duration) > 0)) throw new Error("retime needs music.duration");

  // The floor is an AESTHETIC one and is deliberately stricter than the engine's
  // MIN_SCENE (2s): a 2s scene validates but reads as a flash. The ceiling is not ours
  // to choose — MAX_SCENE is the engine's hard limit, and a slide past it is rejected
  // outright by validateTimeline, so the film does not render at all.
  const minScene = options.minScene ?? 2.5;
  const maxScene = options.maxScene ?? MAX_SCENE;
  const target = Number(music.duration);
  if (!(Number(minScene) > 0)) throw new Error("retime needs a positive minScene");
  if (!(Number(maxScene) >= Number(minScene))) throw new Error("retime needs maxScene >= minScene");
  const minimumDuration = slides.length * Number(minScene);
  if (target < minimumDuration) {
    throw new Error(
      `retime cannot fit ${slides.length} slide(s) into ${target}s ` +
      `with minScene=${minScene}s (needs at least ${minimumDuration}s)`,
    );
  }
  // The mirror image, which this function never used to check: too FEW scenes to cover
  // the track without some slide outgrowing the engine's ceiling. Failing here — with
  // the numbers — beats emitting a timeline the renderer rejects on slide 31.
  const maximumDuration = slides.length * Number(maxScene);
  if (target > maximumDuration) {
    throw new Error(
      `retime cannot stretch ${slides.length} slide(s) to cover ${target}s ` +
      `with maxScene=${maxScene}s (covers at most ${maximumDuration}s) — ` +
      `this album needs more photos, or a shorter excerpt of the track`,
    );
  }
  const beat = Number(music.beatGrid?.beatSeconds) || 0.5;
  const phraseTimes = (music.phrases || []).map((item) => Number(item.time)).filter(Number.isFinite);
  const downbeatTimes = (music.downbeats || []).map((item) => Number(item.time)).filter(Number.isFinite);
  const boundaries = [...new Set([...phraseTimes, ...downbeatTimes])].sort((a, b) => a - b);
  // The authored durations are a SHAPE, not a schedule: they say which scene should
  // breathe longer than its neighbour, and the track says how much room there is.
  const weights = slides.map((slide) => Math.max(minScene, Number(slide.duration) || minScene));
  const copy = slides.map((slide) => ({ ...slide, transition: { ...(slide.transition || {}) } }));
  let cursor = 0;
  let snapped = 0;

  for (let index = 0; index < copy.length - 1; index++) {
    const slide = copy[index];
    const kind = energyAt(music, cursor);
    const beats = kind === "build" ? 1 : kind === "calm" ? 2 : 1.5;
    const transitionDuration = slide.transition.type === "none" ? 0
      : +clamp(beat * beats, 0.35, 1.25).toFixed(3);
    slide.transition.duration = transitionDuration;

    // Re-plan against the time ACTUALLY left rather than a scale fixed up front. A snap
    // that lands early or late is then absorbed by the whole rest of the film, instead
    // of accumulating in silence and landing on the final slide as a 32-second card.
    const remainingWeight = weights.slice(index).reduce((sum, w) => sum + w, 0);
    const share = remainingWeight > 0 ? (target - cursor) * (weights[index] / remainingWeight) : minScene;
    const wantedEnd = cursor + share - transitionDuration;

    const slidesLeft = copy.length - index - 1;
    // Both rails, where there used to be one. `latest` keeps enough time for every
    // slide after this one to clear the floor; `earliest` refuses to leave behind more
    // time than they can hold under the ceiling — the rail whose absence let the last
    // slide grow past MAX_SCENE and take the whole render down with it. `slidesLeft *
    // maxScene` is the LOOSEST valid bound (a future slide's net contribution is at most
    // maxScene, reached when its own transition is "none") — tightening it by assuming a
    // transition on every future slide would reject configurations this loop can still
    // satisfy. The true, tighter cost of realistic transitions is instead priced into the
    // maximum a CALLER may request in the first place (see the ceiling check above).
    const latest = Math.min(cursor + maxScene - transitionDuration, target - slidesLeft * minScene);
    const earliest = Math.max(cursor + minScene, target - slidesLeft * maxScene);
    const end = nearestBoundary(boundaries, wantedEnd, earliest, Math.max(earliest, latest));
    if (Math.abs(end - wantedEnd) > 0.001) snapped++;
    slide.duration = +(end - cursor + transitionDuration).toFixed(3);
    cursor = end;
  }

  const last = copy.at(-1);
  last.transition = { ...(last.transition || {}), duration: 0 };
  last.duration = +(target - cursor).toFixed(3);
  if (last.duration < minScene) {
    const shortage = minScene - last.duration;
    copy.at(-2).duration = +(copy.at(-2).duration - shortage).toFixed(3);
    last.duration = minScene;
  }
  // The rails above make this unreachable; it stays as an assertion rather than a
  // clamp, because silently trimming here would hide a real fit failure and hand the
  // customer a film whose last card is wrong instead of telling anyone why.
  if (last.duration > maxScene + 0.001) {
    throw new Error(
      `retime produced a ${last.duration}s closing slide, past maxScene=${maxScene}s ` +
      `(${copy.length} slides, ${target}s track) — the shot list cannot cover this track`,
    );
  }

  // A caption was sized for the AUTHORED slide length; a slide we just shrank can now end
  // before its own caption does, which the engine rejects ("caption exceeds slide
  // duration"). Retiming a slide means retiming what rides on it — clamp each caption into
  // the new length rather than leave a dangling overflow for validation to trip on.
  for (const slide of copy) {
    if (!Array.isArray(slide.captions)) continue;
    for (const caption of slide.captions) {
      const start = Number(caption.start) || 0;
      if (start + (Number(caption.duration) || 0) > slide.duration - 0.001) {
        caption.duration = +Math.max(0.1, slide.duration - start).toFixed(3);
      }
    }
  }

  return {
    slides: copy,
    sync: {
      mode: "music-aware-v1",
      targetDuration: +target.toFixed(3),
      bpm: music.bpmEstimate || null,
      beatSeconds: +beat.toFixed(4),
      snappedBoundaries: snapped,
    },
  };
}
