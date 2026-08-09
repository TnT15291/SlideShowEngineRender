import type { Locale, Translate } from "@/lib/i18n"
import { strings, type StringKey } from "@/lib/strings"
import type { LocalizedText, RecipeSummary } from "@/types"

const FALLBACK_BACKGROUND = "#3a302b"
const FALLBACK_ACCENT = "#c9a878"

/** Pick the reader's language out of a bilingual recipe field. */
export function localized(value: LocalizedText | null | undefined, locale: Locale): string {
  if (!value) return ""
  return (locale === "en" ? value.en : value.vi) || value.vi || value.en || ""
}

/** `long_distance` / `wedding-day` → `long distance` / `wedding day`. */
export function humanizeTag(value: string): string {
  return value.replace(/[_-]+/g, " ").trim()
}

/**
 * Story-arc beats and mood/fit tags arrive as engine identifiers
 * (`save_the_date`, `signature`, `long_distance`). Title-casing them produced
 * a row of chips reading "Save The Date → Title → Bride → Groom → Signature",
 * which is our vocabulary, not a couple's. Anything without a translation
 * falls back to the humanised slug, so a new beat is merely untranslated
 * rather than missing.
 */
export function tagLabel(value: string, t: Translate): string {
  // `.label` keeps a slug such as `choosing_each_other` from looking like the
  // `_other` half of a plural pair to the string-table guard in i18n.test.ts.
  const key = `tag.${value}.label`
  return key in strings ? t(key as StringKey) : humanizeTag(value)
}

/** `TEAL_ORANGE_EDITORIAL` → `Teal Orange Editorial`. */
export function humanizeTheme(value: string | null): string | null {
  if (!value) return null
  return humanizeTag(value).toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

/**
 * The recipe's own palette rendered as a swatch. It is the only visual signal
 * we can show before a film exists, so both the library and the intake picker
 * use it rather than each inventing their own placeholder.
 */
export function recipeGradient(recipe: Pick<RecipeSummary, "themeBackground" | "themeAccent">): string {
  return `linear-gradient(135deg, ${recipe.themeBackground || FALLBACK_BACKGROUND} 0%, ${recipe.themeAccent || FALLBACK_ACCENT} 140%)`
}

export function photoRange(recipe: Pick<RecipeSummary, "minPhotos" | "idealPhotos">, t: Translate): string | null {
  if (recipe.minPhotos && recipe.idealPhotos) return t("recipes.photoRange", { min: recipe.minPhotos, ideal: recipe.idealPhotos })
  if (recipe.minPhotos) return t("recipes.photoRangeFrom", { min: recipe.minPhotos })
  return null
}

/**
 * Whether the recipe's swatch needs white lettering or dark. Palettes are
 * author-supplied and run from near-black to pale ivory, so a card that
 * hardcodes white goes unreadable on the light ones — which is exactly what
 * "Afterparty Pulse" and "City to Ceremony" did.
 */
export function swatchPrefersLightInk(recipe: Pick<RecipeSummary, "themeBackground" | "themeAccent">): boolean {
  const background = parseColor(recipe.themeBackground) || parseColor(FALLBACK_BACKGROUND)!
  const accent = parseColor(recipe.themeAccent) || parseColor(FALLBACK_ACCENT)!
  // Average the two stops: the title sits mid-gradient, not on either end.
  const blended = background.map((value, index) => (value + accent[index]) / 2) as [number, number, number]
  // Rec. 709 relative luminance, the weighting the WCAG contrast formula uses.
  return 0.2126 * channel(blended[0]) + 0.7152 * channel(blended[1]) + 0.0722 * channel(blended[2]) < 0.4
}

function channel(value: number): number {
  const ratio = value / 255
  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
}

function parseColor(color: string | null): [number, number, number] | null {
  if (!color) return null
  const hex = color.trim().replace(/^#/, "")
  const expanded = hex.length === 3 ? hex.split("").map((digit) => digit + digit).join("") : hex
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ]
}
