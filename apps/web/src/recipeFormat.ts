import type { RecipeSummary } from "@/types"

const FALLBACK_BACKGROUND = "#3a302b"
const FALLBACK_ACCENT = "#c9a878"

export function humanizeTag(value: string): string {
  return value.replace(/[_-]+/g, " ").trim()
}

export function humanizeTheme(value: string | null): string | null {
  if (!value) return null
  return humanizeTag(value).toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function recipeGradient(recipe: Pick<RecipeSummary, "themeBackground" | "themeAccent">): string {
  return `linear-gradient(135deg, ${recipe.themeBackground || FALLBACK_BACKGROUND} 0%, ${recipe.themeAccent || FALLBACK_ACCENT} 140%)`
}

export function photoRange(recipe: Pick<RecipeSummary, "minPhotos" | "idealPhotos">): string | null {
  if (recipe.minPhotos && recipe.idealPhotos) return `${recipe.minPhotos}–${recipe.idealPhotos} photos`
  if (recipe.minPhotos) return `${recipe.minPhotos}+ photos`
  return null
}

export function swatchPrefersLightInk(recipe: Pick<RecipeSummary, "themeBackground" | "themeAccent">): boolean {
  const background = parseColor(recipe.themeBackground) || parseColor(FALLBACK_BACKGROUND)!
  const accent = parseColor(recipe.themeAccent) || parseColor(FALLBACK_ACCENT)!
  const blended = background.map((value, index) => (value + accent[index]) / 2) as [number, number, number]
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
