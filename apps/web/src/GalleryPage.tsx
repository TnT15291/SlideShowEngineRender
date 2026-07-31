import { useEffect, useState } from "react"
import { ArrowLeft, CalendarDays, Clapperboard, Film, Play } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageToggle } from "@/components/LanguageToggle"
import { apiEventUrl, apiGet } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { intlLocales, useI18n, type Locale } from "@/lib/i18n"

type SharedFilm = { id: string; name: string; updatedAt: string }

function displayFilmName(name: string) {
  return name.replace(/\s+-\s+/g, " — ")
}

function displayDate(updatedAt: string, locale: Locale) {
  const date = new Date(updatedAt)
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(intlLocales[locale], { day: "numeric", month: "short", year: "numeric" }).format(date)
}

export function GalleryPage({ onBack }: { onBack: () => void }) {
  const { t, locale } = useI18n()
  const [films, setFilms] = useState<SharedFilm[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playingFilmId, setPlayingFilmId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    apiGet<SharedFilm[]>("/gallery")
      .then((data) => { if (active) setFilms(data) })
      .catch((reason: unknown) => { if (active) setError(apiMessage(reason, t, "gallery.loadFailed")) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card/70 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-6xl items-center gap-3 px-4 sm:px-6 md:px-8">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label={t("gallery.backToSignIn")}><ArrowLeft className="size-5" /></Button>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20"><Clapperboard className="size-5" /></div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">StoReel</p>
              <h1 className="font-serif text-xl font-semibold leading-tight">{t("gallery.title")}</h1>
            </div>
          </div>
          {/* The gallery is public — a visitor arriving from a shared link has
              never passed the sign-in screen, so this is their only switch. */}
          <LanguageToggle className="ml-auto" />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 md:px-8">
        <div className="mb-8 max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{t("gallery.eyebrow")}</p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">{t("gallery.heading")}</h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("gallery.intro")}</p>
        </div>
        {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
        {films === null && !error && <p className="text-sm text-muted-foreground">{t("gallery.loading")}</p>}
        {films && films.length === 0 && (
          <Card className="grid place-items-center border-dashed py-16">
            <CardContent className="text-center">
              <Film className="mx-auto size-10 text-muted-foreground" />
              <p className="mt-4 text-sm text-muted-foreground">{t("gallery.empty")}</p>
            </CardContent>
          </Card>
        )}
        {films && films.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {films.map((film) => (
              <Card key={film.id} className="group overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
                {playingFilmId === film.id ? (
                  <video
                    autoPlay
                    controls
                    preload="metadata"
                    poster={apiEventUrl(`/gallery/${encodeURIComponent(film.id)}/thumbnail`)}
                    className="aspect-video w-full bg-black"
                    src={apiEventUrl(`/gallery/${encodeURIComponent(film.id)}/video`)}
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={t("gallery.play", { name: displayFilmName(film.name) })}
                    onClick={() => setPlayingFilmId(film.id)}
                    className="relative block aspect-video w-full overflow-hidden bg-sidebar text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <img
                      src={apiEventUrl(`/gallery/${encodeURIComponent(film.id)}/thumbnail`)}
                      alt=""
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
                    />
                    <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-black/10" />
                    <span className="absolute bottom-4 left-4 grid size-11 place-items-center rounded-full bg-white/95 text-primary shadow-lg transition-transform group-hover:scale-105">
                      <Play className="ml-0.5 size-4 fill-current" />
                    </span>
                    <span className="absolute bottom-5 right-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80">{t("gallery.watchFilm")}</span>
                  </button>
                )}
                <CardHeader className="gap-2 p-5">
                  <CardTitle className="font-serif text-xl">{displayFilmName(film.name)}</CardTitle>
                  {displayDate(film.updatedAt, locale) && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarDays className="size-3.5" />
                      {t("gallery.sharedOn", { date: displayDate(film.updatedAt, locale) ?? "" })}
                    </p>
                  )}
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
