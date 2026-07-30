export function shouldWriteRecipeCopy({ tier, language, requested = false }) {
  return requested || (tier === "template" && language === "en");
}
