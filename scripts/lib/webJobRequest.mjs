const LANGUAGES = new Set(["vi", "en"]);

/** Resolve the optional video language before creating project.json.
 * `webLanguage` is the UI locale; an explicit video selection always wins. */
export function normalizeWebJobRequest(request) {
  if (!LANGUAGES.has(request?.webLanguage)) throw new Error("webLanguage must be vi|en");
  if (request.language != null && !LANGUAGES.has(request.language)) throw new Error("language must be vi|en");
  return { ...request, language: request.language || request.webLanguage };
}
