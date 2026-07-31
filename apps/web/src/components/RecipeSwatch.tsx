import { Clapperboard } from "lucide-react"

import { cn } from "@/lib/utils"
import { humanizeTheme, recipeGradient, swatchPrefersLightInk } from "@/recipeFormat"
import type { RecipeSummary } from "@/types"

type SwatchRecipe = Pick<RecipeSummary, "name" | "libraryTheme" | "themeBackground" | "themeAccent" | "palette">

/**
 * The visual stand-in for a recipe, used everywhere one is offered — the
 * library and the intake picker. Choosing a film's whole look from a paragraph
 * of prose is the thing this exists to prevent, so it stays identical in both
 * places rather than each screen styling its own card.
 */
export function RecipeSwatch({ recipe, className, compact = false }: { recipe: SwatchRecipe; className?: string; compact?: boolean }) {
  const lightInk = swatchPrefersLightInk(recipe)
  const theme = humanizeTheme(recipe.libraryTheme)
  const swatches = Object.entries(recipe.palette).slice(0, 6)

  return <div
    className={cn("relative flex flex-col justify-end overflow-hidden", compact ? "h-20 p-3" : "h-28 p-4", className)}
    style={{ background: recipeGradient(recipe) }}
  >
    {/* Guarantees the lettering keeps its contrast even when a palette lands
        near the luminance threshold the ink choice is made on. */}
    <div className={cn("absolute inset-0 bg-gradient-to-t", lightInk ? "from-black/45 to-transparent" : "from-white/55 to-transparent")} />
    <Clapperboard className={cn("absolute right-3 top-3 size-4", lightInk ? "text-white/70" : "text-black/40")} aria-hidden="true" />
    {swatches.length > 0 && <div className="absolute left-3 top-3 flex gap-1" aria-hidden="true">
      {swatches.map(([name, color]) => <span key={name} title={`${name}: ${color}`} className="size-2.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: color }} />)}
    </div>}
    <div className={cn("relative", lightInk ? "text-white" : "text-neutral-900")}>
      <p className={cn("font-serif font-semibold leading-tight", compact ? "text-base" : "text-lg")}>{recipe.name}</p>
      {theme && <p className={cn("text-[10px] uppercase tracking-[0.14em]", lightInk ? "text-white/75" : "text-black/60")}>{theme}</p>}
    </div>
  </div>
}
