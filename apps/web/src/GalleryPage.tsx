import { useEffect, useState } from "react"
import { ArrowLeft, Clapperboard, Film } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { apiEventUrl, apiGet, ApiError } from "@/lib/api"

type SharedFilm = { id: string; name: string; updatedAt: string }

export function GalleryPage({ onBack }: { onBack: () => void }) {
  const [films, setFilms] = useState<SharedFilm[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    apiGet<SharedFilm[]>("/gallery")
      .then((data) => { if (active) setFilms(data) })
      .catch((reason: unknown) => { if (active) setError(reason instanceof ApiError ? reason.message : "Unable to load the gallery") })
    return () => { active = false }
  }, [])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center gap-4 border-b px-6 md:px-10">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button>
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">StoReel</p>
            <h1 className="font-serif text-xl font-semibold">Shared films</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
        {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
        {films === null && !error && <p className="text-sm text-muted-foreground">Loading shared films…</p>}
        {films && films.length === 0 && (
          <Card className="grid place-items-center border-dashed py-16">
            <CardContent className="text-center">
              <Film className="mx-auto size-10 text-muted-foreground" />
              <p className="mt-4 text-sm text-muted-foreground">No films have been shared publicly yet.</p>
            </CardContent>
          </Card>
        )}
        {films && films.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {films.map((film) => (
              <Card key={film.id} className="overflow-hidden">
                <video
                  controls
                  preload="none"
                  className="aspect-video w-full bg-black"
                  src={apiEventUrl(`/gallery/${encodeURIComponent(film.id)}/video`)}
                />
                <CardHeader>
                  <CardTitle className="text-base">{film.name}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
