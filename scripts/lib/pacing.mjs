// Single source of truth for the music-energy -> pacing math (Phase E / node 11).
//
// generateStoryClipV2 uses this to CHOOSE slide durations; qaProxy uses it to
// independently CHECK them. Sharing one copy is what keeps the check honest: if
// the curve below is ever retuned, both sides move together, so the only thing
// QA actually measures is the thing that genuinely differs between them —
//
//   • the generator samples energy at each slide's START instant  -> energy.at(t)
//   • QA measures the MEAN energy across the span the slide occupies -> energy.meanOver(t0,t1)
//
// A slide that opens on a quiet bar and then runs into a chorus was given a long
// "calm" duration by the generator but is objectively too slow for the music it
// actually covers. That divergence, plus the story_plan emphasis multiplier and
// any hand edits to the timeline, is the real signal in the pacing proxy.

export const DUR_CALM = 6.9;   // seconds for a scene over the quietest music
export const DUR_LOUD = 4.7;   // ... and over the loudest
export const XFADE_CALM = 0.95;
export const XFADE_LOUD = 0.45;

// analyzeMusic decimates its 0.1s-hop envelope to every 5th window, so the
// stored `envelope` array is one sample per 0.5s. Keep this in step with it.
export const ENV_STEP = 0.5;

const clamp01 = (e) => Math.min(1, Math.max(0, e));
export const lerp = (a, b, e) => a + (b - a) * clamp01(e);
export const sceneDur = (e) => Math.round(lerp(DUR_CALM, DUR_LOUD, e) * 10) / 10;
export const xfadeDur = (e) => Math.round(lerp(XFADE_CALM, XFADE_LOUD, e) * 100) / 100;

/** Bar length in seconds from the estimated BPM (4-beat bars). */
export const barLength = (music) => (60 / (music.bpmEstimate || 120)) * 4;

/**
 * Energy sampler over an analyzeMusic document.
 * @returns {{at:(t:number)=>number, meanOver:(t0:number,t1:number)=>number, windows:number}}
 */
export function makeEnergy(music) {
  const env = music.envelope || [];
  const fallback = music.energy?.mean ?? 0.5;

  // Guard against analyzeMusic changing its decimation without this file noticing.
  if (env.length > 1 && music.duration) {
    const actual = music.duration / env.length;
    if (Math.abs(actual - ENV_STEP) > 0.1) {
      console.warn(
        `[pacing] envelope spacing looks like ${actual.toFixed(3)}s, not ENV_STEP=${ENV_STEP}s — ` +
          `analyzeMusic's decimation may have changed; pacing numbers will be skewed.`
      );
    }
  }

  const idx = (t) => Math.min(env.length - 1, Math.max(0, Math.round(t / ENV_STEP)));
  const at = (t) => (env.length ? env[idx(t)] ?? fallback : fallback);

  const meanOver = (t0, t1) => {
    if (!env.length) return fallback;
    const i0 = Math.max(0, Math.min(env.length - 1, Math.floor(t0 / ENV_STEP)));
    const i1 = Math.max(i0, Math.min(env.length - 1, Math.ceil(t1 / ENV_STEP)));
    let s = 0;
    for (let i = i0; i <= i1; i++) s += env[i];
    return s / (i1 - i0 + 1);
  };

  return { at, meanOver, windows: env.length };
}

/**
 * Wall-clock start/end of every slide, accounting for the xfade overlap into the
 * NEXT slide (a slide's transition eats into the following one's start).
 */
export function sceneTimes(slides) {
  const out = [];
  let t = 0;
  for (const s of slides) {
    const trans = s.transition?.duration || 0;
    out.push({
      id: s.id,
      start: +t.toFixed(3),
      end: +(t + s.duration).toFixed(3),
      mid: +(t + s.duration / 2).toFixed(3),
      dur: s.duration,
    });
    t += s.duration - trans;
  }
  return out;
}
