/**
 * Turns narration timing into slide timing.
 *
 * The engine treats `slide.transition` as the transition OUT of that slide
 * (buildFinalVideoCommand.ts: `offset = acc - dur`), so a slide authored as
 * `span + overlap` seconds contributes exactly `span` seconds to the finished
 * film. Every function here preserves that invariant: the boundaries move, the
 * total never does.
 */

/**
 * Merge windows that fall under the engine's minimum slide duration.
 *
 * Keeps absorbing the following window until the group clears `minimum` — one
 * merge is not always enough, and a group that stays short only fails later, as
 * an opaque validate error hours into a render.
 */
export function coalesceShortWindows(windows, minimum = 2) {
  const groups = [];
  for (let index = 0; index < windows.length; index += 1) {
    const current = { ...windows[index], beats: [...windows[index].beats] };
    while (current.end - current.start < minimum && index + 1 < windows.length) {
      const next = windows[index + 1];
      current.end = next.end;
      current.speechEnd = next.speechEnd;
      current.beats.push(...next.beats);
      index += 1;
    }
    if (current.end - current.start >= minimum) {
      groups.push(current);
      continue;
    }
    // Tail window with nothing left to absorb: fold it back into its predecessor.
    if (!groups.length) throw new Error("Narration is shorter than the engine's two-second minimum slide duration");
    const last = groups[groups.length - 1];
    last.end = current.end;
    last.speechEnd = current.speechEnd;
    last.beats.push(...current.beats);
  }
  return groups;
}

/**
 * Pull each cut off the first word of the next line.
 *
 * A boundary left exactly on `segments[i+1].start` makes the engine BEGIN the
 * dissolve as the next sentence begins, so the incoming picture only lands a
 * full transition-length into the line while the whole pause plays over the
 * outgoing one. Moving the boundary back by the overlap makes the dissolve
 * FINISH on the first word instead — never cutting into speech, never taking a
 * group below the minimum slide duration.
 */
export function alignCutsToPauses(groups, minimum = 2) {
  for (let index = 0; index < groups.length - 1; index += 1) {
    const current = groups[index];
    const overlap = transitionFor(current, groups[index + 1], current.beats.at(-1)?.transition).duration;
    const floor = Math.max(current.speechEnd ?? current.end, current.start + minimum);
    const boundary = Math.min(current.end, Math.max(floor, current.end - overlap));
    current.end = boundary;
    groups[index + 1].start = boundary;
  }
  return groups;
}

export function splitWindow(window, maxSpan = 28) {
  const span = window.end - window.start;
  const count = Math.max(1, Math.ceil(span / maxSpan));
  return Array.from({ length: count }, (_, index) => ({
    ...window,
    start: window.start + (span * index) / count,
    end: window.start + (span * (index + 1)) / count,
    part: index + 1,
    partCount: count,
  }));
}

export function renderedDuration(slides) {
  return slides.reduce((total, slide) => total + slide.duration - slide.transition.duration, 0);
}

export function transitionFor(current, next, explicit) {
  if (!next) return { type: "none", duration: 0 };
  if (explicit) return explicit;
  const currentSection = current.beats.at(-1)?.section;
  const nextSection = next.beats[0]?.section;
  return currentSection && nextSection && currentSection !== nextSection
    ? { type: "fade_slow", duration: 1 }
    : { type: "crossfade", duration: 0.6 };
}
