/**
 * How much text a card can carry — one number, one place.
 *
 * The engine's hard rule is a reading rate: text that cannot be read while its
 * card is on screen gets trimmed by scripts/fitTextInTimeline.mjs, with an
 * ellipsis, no matter how good the sentence was. That rate used to be written
 * out as a bare `language === "en" ? 3 : 18` in three separate files, and the
 * prompts that ask an AI to WRITE the words knew nothing about it at all — so
 * the model wrote to no budget and the pipeline silently amputated whatever
 * came back.
 */

// Vietnamese is measured in characters excluding spaces, English in words —
// the two scripts pack meaning at very different densities.
export const READING_UNITS_PER_SECOND = { vi: 18, en: 3 };

export const readingLimit = (language) => READING_UNITS_PER_SECOND[language === "en" ? "en" : "vi"];

/**
 * The duration a story card is designed around.
 *
 * Measured on a real 41-scene Lite film: the scenes that carry story prose run
 * 5.25s, and the tightest caption host ran 4.65s. Five seconds is the honest
 * middle, and it is deliberately not the longest card in the film — a budget
 * written against the roomiest case is not a budget.
 */
export const STORY_CARD_SECONDS = 5;

// Vietnamese runs 3.63 non-space characters per word, measured over a real
// generated story. Only used to restate the budget in words, because a model
// counts words far more reliably than it counts characters.
const VI_CHARS_PER_WORD = 3.63;

/**
 * What one chapter of story prose may be, phrased for a prompt.
 *
 * `units` is in exactly what the fitter counts, so the number needs no
 * conversion to be checked; `sentence` restates it for a model to act on.
 */
export function storyBodyBudget(language) {
  const english = language === "en";
  const units = Math.floor(STORY_CARD_SECONDS * readingLimit(language));
  const words = english ? units : Math.round(units / VI_CHARS_PER_WORD);
  return {
    units,
    words,
    unit: english ? "words" : "characters excluding spaces",
    sentence: english
      ? `at most ${units} words`
      : `at most ${units} characters excluding spaces — roughly ${words} words`,
  };
}
