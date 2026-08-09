import { useState } from "react"
import { Clapperboard } from "lucide-react"

import { cn } from "@/lib/utils"
import { humanizeTheme, recipeGradient, swatchPrefersLightInk } from "@/recipeFormat"
import type { RecipeSummary } from "@/types"

type SwatchRecipe = Pick<RecipeSummary, "id" | "name" | "libraryTheme" | "themeBackground" | "themeAccent" | "palette">

/**
 * The visual stand-in for a recipe, used everywhere one is offered — the
 * library and the intake picker. Choosing a film's whole look from a paragraph
 * of prose is the thing this exists to prevent, so it stays identical in both
 * places rather than each screen styling its own card.
 */
export function RecipeSwatch({ recipe, className, compact = false }: { recipe: SwatchRecipe; className?: string; compact?: boolean }) {
  const [imageLoaded, setImageLoaded] = useState(false)
  const lightInk = imageLoaded || swatchPrefersLightInk(recipe)
  const theme = humanizeTheme(recipe.libraryTheme)
  const swatches = Object.entries(recipe.palette).slice(0, 6)

  return <div
    className={cn("relative flex flex-col justify-end overflow-hidden", compact ? "h-20 p-3" : "h-28 p-4", className)}
    style={{ background: recipeGradient(recipe) }}
  >
    <img
      src={`/recipe-previews/${encodeURIComponent(recipe.id)}.jpg`}
      alt=""
      loading="lazy"
      className="absolute inset-0 h-full w-full object-cover"
      onLoad={() => setImageLoaded(true)}
      onError={(event) => { event.currentTarget.hidden = true; setImageLoaded(false) }}
      aria-hidden="true"
    />
    {/*
      A linear scrim reached only ~black/38 behind the title, because the text
      block sits about a quarter of the way up rather than on the very bottom
      edge where `from-` is at full strength. On the White Weddings and Garden
      themes — near-white photographs — the recipe name was close to unreadable,
      and it is the only place the name is drawn at all (RecipeLibrary's
      CardTitle is `sr-only`). The scrim is now a solid band sized to the text
      it has to carry, fading out above it.
    */}
    <div className={cn("absolute inset-x-0 bottom-0 h-3/5", lightInk ? "bg-gradient-to-t from-black/80 from-40% to-transparent" : "bg-gradient-to-t from-white/85 from-40% to-transparent")} />
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
