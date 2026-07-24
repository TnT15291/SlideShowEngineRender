import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Clapperboard, Image, Layers3, Music2, Search, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet } from "@/lib/api"
import type { RecipeSummary } from "@/types"

export function RecipeLibrary({ onBack }: { onBack: () => void }) {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [selected, setSelected] = useState<RecipeSummary | null>(null)
  const [query, setQuery] = useState("")
  const [mood, setMood] = useState("")
  const [photoCount, setPhotoCount] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<RecipeSummary[]>("/recipes")
      .then(setRecipes)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  const moods = useMemo(() => [...new Set((recipes || []).flatMap((recipe) => recipe.moods))].sort(), [recipes])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const count = Number(photoCount)
    return (recipes || []).filter((recipe) => {
      const searchable = [recipe.name, recipe.notes, ...recipe.bestFor, ...recipe.moods].join(" ").toLowerCase()
      if (needle && !searchable.includes(needle)) return false
      if (mood && !recipe.moods.includes(mood)) return false
      if (photoCount && Number.isFinite(count)) {
        if (recipe.minPhotos !== null && count < recipe.minPhotos) return false
        if (recipe.maxPhotos !== null && count > recipe.maxPhotos) return false
      }
      return true
    })
  }, [mood, photoCount, query, recipes])

  async function openRecipe(recipeId: string) {
    try {
      setError(null)
      setSelected(await apiGet<RecipeSummary>(`/recipes/${encodeURIComponent(recipeId)}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center gap-4 border-b px-6 md:px-10">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button>
        <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Tier template</p><h1 className="font-serif text-xl font-semibold">Recipe Library</h1></div>
        {recipes && <Badge variant="secondary" className="ml-auto border-0">{recipes.length} recipes</Badge>}
      </header>

      <div className="mx-auto max-w-[1440px] px-6 py-8 md:px-10">
        <div className="mb-6 grid gap-3 md:grid-cols-[minmax(260px,1fr)_220px_180px]">
          <label className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input className="field mt-0 pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, style, or mood…" /></label>
          <select className="field mt-0" value={mood} onChange={(event) => setMood(event.target.value)} aria-label="Filter by mood"><option value="">All moods</option>{moods.map((item) => <option key={item}>{item}</option>)}</select>
          <input className="field mt-0" type="number" min="1" value={photoCount} onChange={(event) => setPhotoCount(event.target.value)} placeholder="Photo count" />
        </div>

        {error && <Card className="mb-5 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
        {!error && !recipes && <p className="text-sm text-muted-foreground">Loading recipe library…</p>}

        {recipes && <>
          <p className="mb-4 text-sm text-muted-foreground">Showing {filtered.length} of {recipes.length} recipes</p>
          {filtered.length === 0 ? <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">No recipe matches these filters.</CardContent></Card> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} onOpen={() => openRecipe(recipe.id)} />)}</div>}
        </>}
      </div>

      {selected && <RecipeDetail recipe={selected} onClose={() => setSelected(null)} />}
    </main>
  )
}

function RecipeCard({ recipe, onOpen }: { recipe: RecipeSummary; onOpen: () => void }) {
  const swatchBg = recipe.themeBackground || "#3a302b"
  const swatchAccent = recipe.themeAccent || "#c9a878"
  const range = recipe.minPhotos && recipe.idealPhotos ? `${recipe.minPhotos}–${recipe.idealPhotos} photos` : recipe.minPhotos ? `From ${recipe.minPhotos} photos` : null
  return <button onClick={onOpen} className="text-left"><Card className="h-full overflow-hidden transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
    <div className="relative flex h-28 items-end p-4" style={{ background: `linear-gradient(135deg, ${swatchBg} 0%, ${swatchAccent} 140%)` }}><Clapperboard className="absolute right-4 top-4 size-5 text-white/70" /><div className="text-white"><p className="font-serif text-lg font-semibold leading-tight">{recipe.name}</p>{recipe.libraryTheme && <p className="text-[11px] uppercase tracking-[0.14em] text-white/70">{recipe.libraryTheme}</p>}</div></div>
    <CardHeader className="pb-3"><CardTitle className="sr-only">{recipe.name}</CardTitle>{recipe.notes && <p className="line-clamp-2 text-sm text-muted-foreground">{recipe.notes}</p>}</CardHeader>
    <CardContent className="space-y-4 pt-0">
      {recipe.bestFor.length > 0 && <div className="flex flex-wrap gap-1.5">{recipe.bestFor.slice(0, 4).map((tag) => <Badge key={tag} variant="outline" className="font-normal">{tag}</Badge>)}</div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">{range && <span className="flex items-center gap-1.5"><Image className="size-3.5" /> {range}</span>}<span className="flex items-center gap-1.5"><Layers3 className="size-3.5" /> {recipe.sceneCount} scenes · {recipe.lookCount} looks</span>{recipe.energy && <span className="flex items-center gap-1.5"><Music2 className="size-3.5" /> {recipe.energy}</span>}</div>
      {recipe.pacingVariants.length > 0 && <div className="flex flex-wrap gap-1.5 border-t pt-3">{recipe.pacingVariants.map((variant) => <Badge key={variant} variant="secondary" className="border-0 font-normal">{variant}</Badge>)}</div>}
    </CardContent>
  </Card></button>
}

function RecipeDetail({ recipe, onClose }: { recipe: RecipeSummary; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose}><aside className="h-full w-full max-w-xl overflow-y-auto bg-background p-7 shadow-2xl" onClick={(event) => event.stopPropagation()}>
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Recipe details</p><h2 className="mt-2 font-serif text-3xl font-semibold">{recipe.name}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{recipe.notes}</p></div><Button variant="ghost" size="icon" onClick={onClose}><X className="size-4" /></Button></div>
    <div className="mt-8 grid grid-cols-3 gap-3"><DetailStat label="Scenes" value={String(recipe.sceneCount)} /><DetailStat label="Looks" value={String(recipe.lookCount)} /><DetailStat label="Energy" value={recipe.energy || "Flexible"} /></div>
    <section className="mt-8"><h3 className="text-sm font-semibold">Photo fit</h3><p className="mt-2 text-sm text-muted-foreground">Minimum {recipe.minPhotos ?? "—"} · Ideal {recipe.idealPhotos ?? "—"} · Maximum {recipe.maxPhotos ?? "open"}</p></section>
    <section className="mt-8"><h3 className="text-sm font-semibold">Story arc</h3><div className="mt-3 flex flex-wrap gap-2">{recipe.storyArc.map((beat, index) => <span key={`${beat}-${index}`} className="rounded-full bg-secondary px-3 py-1.5 text-xs">{index + 1}. {beat}</span>)}</div></section>
    <section className="mt-8"><h3 className="text-sm font-semibold">Palette</h3><div className="mt-3 flex flex-wrap gap-3">{Object.entries(recipe.palette).map(([name, color]) => <div key={name} title={`${name}: ${color}`}><div className="size-10 rounded-full border shadow-sm" style={{ backgroundColor: color }} /><p className="mt-1 max-w-14 truncate text-[10px] text-muted-foreground">{name}</p></div>)}</div></section>
    <section className="mt-8"><h3 className="text-sm font-semibold">Best for</h3><div className="mt-3 flex flex-wrap gap-2">{recipe.bestFor.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div></section>
  </aside></div>
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-card p-4"><p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 font-medium capitalize">{value}</p></div>
}
