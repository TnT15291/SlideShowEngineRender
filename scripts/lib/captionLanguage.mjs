const VI_MARKS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu;
const VI_WORDS = new Set("và của là một những với cho trong ngày tình yêu chúng tôi bạn bên nhau cưới hạnh phúc cảm ơn".split(" "));
const EN_WORDS = new Set("and the is are a an of to with for in our your love wedding together forever thank you this that day".split(" "));
const ENGLISH_CARD_WORDS = new Set(`
  a about after all always among and around are beautiful began begin beginning best big botanical
  branches bride celebration celebrating chapters cheers city closer continues dance dancefloor date day
  dear diary distance doesn't endless ever every fall film final fire first flowers forever friendship from
  future garden getting go golden groom handed here's hour in it journey just last laughter led lifetime light
  little love lovers married meet memories moment moments more music night of on one only our out pages party
  path pictures ready remember roots save side small song special started step story strangers sunset sweet
  tender thank the through time to together tonight touches turn two up us walk we welcome wedding we're where
  with would written yes you your yours
`.trim().split(/\s+/));

// The aggregate detector below deliberately tolerates short captions because it also
// judges customer names and sparse finished timelines. Recipe authoring is stricter:
// even a one-word English card such as "FOREVER" creates a mixed-language Vietnamese
// film, so lint/tests call this per authored string.
export function hasEnglishCopy(value) {
  const text = String(value ?? "").replace(/\{\{[^}]+\}\}/g, "").trim();
  if (!text) return false;
  if (/\bP\.S\./iu.test(text)) return true;
  const tokens = text.toLocaleLowerCase().match(/[\p{L}']+/gu) || [];
  const english = tokens.filter((word) => ENGLISH_CARD_WORDS.has(word));
  return english.length >= 2
    || (tokens.length === 1 && english.length === 1 && /^[a-z']+$/iu.test(text));
}

// Common UTF-8 bytes decoded as Windows-1252/Latin-1. A bare `Ã` is valid
// Vietnamese (for example `MÃI`), so only flag it when followed by a character
// that can represent a mis-decoded UTF-8 continuation byte.
const UTF8_CONTINUATION_AS_TEXT = "[\\u0080-\\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]";
const MOJIBAKE = new RegExp(`(?:Ã${UTF8_CONTINUATION_AS_TEXT}|[ÄÅÆ]${UTF8_CONTINUATION_AS_TEXT}|á[º»])`);

export function hasMojibake(value) {
  return MOJIBAKE.test(String(value ?? ""));
}

export function inspectCaptionLanguage(texts, expected) {
  if (!new Set(["vi", "en"]).has(expected)) return { status: "skipped", reason: "timeline has no supported language metadata", flagged: 0 };
  const text = texts.filter(Boolean).join(" ");
  const tokens = text.toLocaleLowerCase().match(/[\p{L}]+/gu) || [];
  const viMarks = (text.match(VI_MARKS) || []).length;
  const viWords = tokens.filter((word) => VI_WORDS.has(word)).length;
  const enWords = tokens.filter((word) => EN_WORDS.has(word)).length;
  const viSignal = viMarks + viWords;
  const mismatch = expected === "en"
    ? viSignal >= 3 && enWords === 0
    : enWords >= 4 && viSignal === 0;
  const mixed = viSignal >= 4 && enWords >= 4 && Math.min(viSignal, enWords) / Math.max(viSignal, enWords) >= 0.6;
  const flags = [mismatch && "wrong_caption_language", mixed && "mixed_caption_languages"].filter(Boolean);
  return { status: "ran", expected, textCount: texts.length, signals: { viMarks, viWords, enWords }, flags, flagged: flags.length ? 1 : 0 };
}
