/**
 * Narration beats are paragraph-sized: one beat as one subtitle cue would put
 * ~280 characters on screen for twenty seconds. These helpers cut a beat into
 * cues someone can actually read — broadcast practice is two lines of about 42
 * characters — and hand each cue a share of the beat's window.
 */

export const MAX_CUE_CHARS = 84;
export const MAX_LINE_CHARS = 42;

/** Split into evenly sized chunks so the tail cue is never a two-word flash. */
export function chunkCue(text, limit = MAX_CUE_CHARS) {
  const clean = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return [];
  const target = Math.ceil(clean.length / Math.max(1, Math.ceil(clean.length / limit)));
  const chunks = [];
  let current = "";
  for (const word of clean.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > target) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Break one cue into two balanced lines at the space nearest the middle. */
export function wrapCue(text, width = MAX_LINE_CHARS) {
  if (text.length <= width) return text;
  const middle = text.length / 2;
  let best = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== " ") continue;
    if (best < 0 || Math.abs(index - middle) < Math.abs(best - middle)) best = index;
  }
  return best < 0 ? text : `${text.slice(0, best)}\n${text.slice(best + 1)}`;
}

/** Spread a segment's window over its cues in proportion to their length. */
export function cuesForSegment(segment) {
  const chunks = chunkCue(segment.text);
  if (!chunks.length) return [];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const span = Number(segment.end) - Number(segment.start);
  let cursor = Number(segment.start);
  return chunks.map((chunk, index) => {
    const end = index === chunks.length - 1 ? Number(segment.end) : cursor + (span * chunk.length) / total;
    const cue = { start: cursor, end, text: wrapCue(chunk) };
    cursor = end;
    return cue;
  });
}
