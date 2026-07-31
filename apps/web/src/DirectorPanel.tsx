import { useEffect, useState } from "react"
import { AlertCircle, Check, Clock3, Music2, RefreshCw, Sparkles, WandSparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { intlLocales, useI18n, type Locale, type Translate } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { musicModeLabelKey } from "@/projectFormat"
import type { DirectorState, ProjectSummary, StoryDirection } from "@/types"

export function DirectorPanel({ project }: { project: ProjectSummary }) {
  const { t, locale } = useI18n()
  const [state, setState] = useState<DirectorState | null>(null)
  const [brief, setBrief] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  async function refresh() {
    setError(null)
    try { const value = await apiGet<DirectorState>(`/projects/${project.id}/director`); setState(value); setBrief(value.brief) }
    catch (reason) { setError(apiMessage(reason, t)) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [project.id])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])

  async function act(name: string, path: string, body: unknown, message: string) {
    setBusy(name); setError(null); setNotice(null)
    try { setState(await apiPost<DirectorState>(`/projects/${project.id}/director/${path}`, body)); setNotice(message) }
    catch (reason) { setError(apiMessage(reason, t)) } finally { setBusy(null) }
  }

  const selected = state?.selectedStory?.choice
  const deadline = state?.storyWindow?.status === "open" ? state.storyWindow.deadlineAt : null
  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><WandSparkles className="size-4 text-primary" /> {t("director.title", { tier: t(project.tier === "premium" ? "tier.premium" : "tier.lite") })}</CardTitle><CardDescription className="mt-1">{t("director.description")}</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy !== null}><RefreshCw className={cn("size-4", busy === "refresh" && "animate-spin")} /> {t("common.refresh")}</Button></div></CardHeader>
    <CardContent className="space-y-6 p-6">
      {error && <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      {notice && <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{notice}</p>}
      <section><div className="mb-2 flex items-center justify-between"><label className="text-sm font-medium">{t("director.instructions")}</label><span className="text-xs text-muted-foreground">{brief.trim().split(/\s+/).filter(Boolean).length} {t("common.words")}</span></div><textarea rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder={t("director.placeholder")} className="w-full resize-y rounded-lg border bg-background px-3 py-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{t(project.tier === "premium" ? "director.premiumHint" : "director.liteHint")}</p><Button onClick={() => void act("generate", "generate", { brief }, t(project.tier === "premium" ? "director.premiumGenerated" : "director.liteGenerated"))} disabled={!brief.trim() || busy !== null}><Sparkles className="size-4" /> {busy === "generate" ? t("director.generating") : state?.storyOptions || state?.liteStory ? t("director.regenerate") : t("director.generate")}</Button></div></section>

      {state?.tier === "lite" && state.liteStory && <section className="rounded-xl border bg-card-soft p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-serif text-xl font-semibold">{state.liteStory.title || t("director.generatedStory")}</h3><Badge variant="outline">{state.liteStory.generatedBy || t("director.generated")}</Badge></div><div className="mt-4 grid gap-3 md:grid-cols-2">{state.liteStory.beats?.map((beat, index) => <div key={`${index}-${beat.heading}`} className="rounded-lg border bg-background p-3"><div className="flex items-center gap-2"><span className="text-xs font-semibold">{index + 1}. {beat.heading}</span><Badge variant="secondary">{beat.emotion}</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{beat.body}</p></div>)}</div></section>}

      {state?.tier === "premium" && state.storyOptions && <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">{t("director.storyDirections")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("director.storyDirectionsHint")}</p></div>{deadline && <Badge variant="outline" className="gap-1"><Clock3 className="size-3" /> {t("director.waiting", { remaining: remaining(deadline, now, t), deadline: formatDate(deadline, locale) })}</Badge>}</div><div className="grid gap-3 md:grid-cols-2">{state.storyOptions.options.map((option) => <DirectionCard key={option.id} option={option} recommended={option.id === state.storyOptions?.recommended} selected={option.id === selected} disabled={busy !== null} onSelect={() => void act(`story-${option.id}`, "story", { choice: option.id }, t("director.directionSelected", { id: option.id }))} />)}</div></section>}

      {state?.tier === "premium" && <section className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Music2 className="size-4 text-primary" /> {t("director.musicWindow")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("director.musicWindowHint")}</p></div>{state.selectedMusic && <Badge variant="outline">{t(musicModeLabelKey[state.selectedMusic.mode] ?? "musicMode.auto")} · {state.selectedMusic.source}</Badge>}</div>{state.selectedMusic?.preview && <p className="mt-3 text-sm text-muted-foreground">{t("director.suggestedHighlight", { start: formatSeconds(state.selectedMusic.preview.start), end: formatSeconds(state.selectedMusic.preview.end), duration: Math.round(state.selectedMusic.preview.duration) })}</p>}<div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => void act("music-highlight", "music", { mode: "highlight" }, t("director.highlightSelected"))} disabled={busy !== null}>{t("director.useHighlight")}</Button><Button size="sm" variant="outline" onClick={() => void act("music-full", "music", { mode: "full_song" }, t("director.fullSongSelected"))} disabled={busy !== null}>{t("director.keepFullSong")}</Button></div>{state.selectedMusic?.reason && <p className="mt-3 text-xs leading-5 text-muted-foreground">{state.selectedMusic.reason}</p>}</section>}

      {state?.directorNotes && <section><div className="mb-3"><h3 className="text-sm font-semibold">{t("director.decisions")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("director.decisionsHint")}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries({ ...(state.directorNotes.creative_brief || {}), ...(state.directorNotes.director_notes || {}) }).filter(([, value]) => typeof value === "string" || value === null).map(([key, value]) => <div key={key} className="rounded-lg border bg-card-soft p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{humanize(key)}</p><p className="mt-1 text-sm">{value === null || value === undefined ? t("common.none") : String(value)}</p></div>)}</div></section>}

      {state?.storyPlan?.segments && <section><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">{t("director.fiveActPlan")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("director.fiveActFlow")}</p></div><Badge variant="outline"><Check className="mr-1 size-3" /> {t("director.readyForTimeline")}</Badge></div><div className="grid gap-2 lg:grid-cols-5">{state.storyPlan.segments.map((segment, index) => <div key={segment.segment} className="rounded-lg border bg-background p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{index + 1}. {humanize(segment.segment)}</span><Badge variant="secondary">{segment.emphasis}</Badge></div><p className="mt-2 text-sm leading-5">{segment.goal}</p><p className="mt-3 text-xs text-muted-foreground">{segment.emotion} · {segment.pacing}</p><p className="mt-1 text-xs text-muted-foreground">{t("director.effect", { effect: humanize(segment.priorityEffect) })}</p></div>)}</div><p className="mt-3 text-xs text-muted-foreground">{t("director.continueHint", { step: t("workspace.step.review") })}</p></section>}
    </CardContent>
  </Card>
}

function DirectionCard({ option, recommended, selected, disabled, onSelect }: { option: StoryDirection; recommended: boolean; selected: boolean; disabled: boolean; onSelect: () => void }) {
  const { t } = useI18n()
  return <button onClick={onSelect} disabled={disabled} className={cn("rounded-xl border p-4 text-left transition-colors", selected ? "border-primary bg-primary/5" : "bg-background hover:border-primary/50")}><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">{option.id}</span><span className="font-serif text-lg font-semibold">{option.title}</span>{recommended && <Badge variant="secondary" className="ml-auto">{t("common.recommended")}</Badge>}{selected && <Check className="ml-auto size-4 text-primary" />}</div><p className="mt-3 text-sm leading-6 text-muted-foreground">{option.summary}</p><p className="mt-3 text-xs"><span className="font-medium">{t("director.mood")}</span> {option.mood} · {option.pacing}</p><p className="mt-2 text-xs text-muted-foreground">{option.emotionalArc}</p>{option.fitReason && <p className="mt-2 text-xs text-primary">{t("director.whyItFits")} {option.fitReason}</p>}</button>
}
function humanize(value: string) { return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2") }
function formatDate(value: string, locale: Locale) { return new Intl.DateTimeFormat(intlLocales[locale], { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) }
function remaining(deadline: string, now: number, t: Translate) {
  const minutes = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 60_000))
  return minutes > 60
    ? t("director.hoursLeft", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : t("director.minutesLeft", { minutes })
}
function formatSeconds(value: number) { return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}` }
