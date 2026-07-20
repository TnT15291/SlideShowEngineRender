const VI_MARKS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/giu;
const VI_WORDS = new Set("và của là một những với cho trong ngày tình yêu chúng tôi bạn bên nhau cưới hạnh phúc cảm ơn".split(" "));
const EN_WORDS = new Set("and the is are a an of to with for in our your love wedding together forever thank you this that day".split(" "));

export function inspectCaptionLanguage(texts, expected) {
  if (!new Set(["vi", "en"]).has(expected)) return { status: "skipped", reason: "timeline has no supported language metadata", flagged: 0 };
  const text = texts.filter(Boolean).join(" ");
  const tokens = text.toLocaleLowerCase().match(/[\p{L}]+/gu) || [];
  const viMarks = (text.match(VI_MARKS) || []).length;
  const viWords = tokens.filter((word) => VI_WORDS.has(word)).length;
  const enWords = tokens.filter((word) => EN_WORDS.has(word)).length;
  const viSignal = viMarks + viWords;
  const mismatch = expected === "en"
    ? viMarks >= 2 || viWords >= 3
    : enWords >= 4 && viSignal === 0;
  const mixed = viSignal >= 2 && enWords >= 4;
  const flags = [mismatch && "wrong_caption_language", mixed && "mixed_caption_languages"].filter(Boolean);
  return { status: "ran", expected, textCount: texts.length, signals: { viMarks, viWords, enWords }, flags, flagged: flags.length ? 1 : 0 };
}
