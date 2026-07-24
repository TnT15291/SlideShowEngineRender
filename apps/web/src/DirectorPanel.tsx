import { useEffect, useState } from "react"
import { AlertCircle, Check, Clock3, Music2, RefreshCw, Sparkles, WandSparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { DirectorState, ProjectSummary, StoryDirection } from "@/types"

export function DirectorPanel({ project }: { project: ProjectSummary }) {
  const [state, setState] = useState<DirectorState | null>(null)
  const [brief, setBrief] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  async function refresh() {
    setError(null)
    try { const value = await apiGet<DirectorState>(`/projects/${project.id}/director`); setState(value); setBrief(value.brief) }
    catch (reason) { setError(messageOf(reason)) }
  }
  useEffect(() => { void refresh() }, [project.id])
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])

  async function act(name: string, path: string, body: unknown, message: string) {
    setBusy(name); setError(null); setNotice(null)
    try { setState(await apiPost<DirectorState>(`/projects/${project.id}/director/${path}`, body)); setNotice(message) }
    catch (reason) { setError(messageOf(reason)) } finally { setBusy(null) }
  }

  const selected = state?.selectedStory?.choice
  const deadline = state?.storyWindow?.status === "open" ? state.storyWindow.deadlineAt : null
  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><WandSparkles className="size-4 text-primary" /> AI Director · {project.tier === "premium" ? "Premium" : "Lite"}</CardTitle><CardDescription className="mt-1">Turn your direction into an auditable story before generating the timeline.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy !== null}><RefreshCw className={cn("size-4", busy === "refresh" && "animate-spin")} /> Refresh</Button></div></CardHeader>
    <CardContent className="space-y-6 p-6">
      {error && <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      {notice && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
      <section><div className="mb-2 flex items-center justify-between"><label className="text-sm font-medium">Director instructions</label><span className="text-xs text-muted-foreground">{brief.trim().split(/\s+/).filter(Boolean).length} words</span></div><textarea rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Give the AI a role, story outline, mood, important moments, pacing, music notes, constraints, and anything else it should follow…" className="w-full resize-y rounded-lg border bg-background px-3 py-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring" /><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">{project.tier === "premium" ? "Creates four distinct directions A–D." : "Lite creates one concise story from the brief."}</p><Button onClick={() => void act("generate", "generate", { brief }, project.tier === "premium" ? "Four directions generated. The project is waiting for a story choice." : "Lite story generated. Run a dry run to generate its timeline.")} disabled={!brief.trim() || busy !== null}><Sparkles className="size-4" /> {busy === "generate" ? "Generating…" : state?.storyOptions || state?.liteStory ? "Regenerate story" : "Generate story"}</Button></div></section>

      {state?.tier === "lite" && state.liteStory && <section className="rounded-xl border bg-card-soft p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-serif text-xl font-semibold">{state.liteStory.title || "Generated story"}</h3><Badge variant="outline">{state.liteStory.generatedBy || "generated"}</Badge></div><div className="mt-4 grid gap-3 md:grid-cols-2">{state.liteStory.beats?.map((beat, index) => <div key={`${index}-${beat.heading}`} className="rounded-lg border bg-background p-3"><div className="flex items-center gap-2"><span className="text-xs font-semibold">{index + 1}. {beat.heading}</span><Badge variant="secondary">{beat.emotion}</Badge></div><p className="mt-2 text-sm leading-6 text-muted-foreground">{beat.body}</p></div>)}</div></section>}

      {state?.tier === "premium" && state.storyOptions && <section><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Story directions</h3><p className="mt-1 text-xs text-muted-foreground">Choose one direction to generate director notes and the five-act plan.</p></div>{deadline && <Badge variant="outline" className="gap-1"><Clock3 className="size-3" /> Waiting · {remaining(deadline, now)} · until {formatDate(deadline)}</Badge>}</div><div className="grid gap-3 md:grid-cols-2">{state.storyOptions.options.map((option) => <DirectionCard key={option.id} option={option} recommended={option.id === state.storyOptions?.recommended} selected={option.id === selected} disabled={busy !== null} onSelect={() => void act(`story-${option.id}`, "story", { choice: option.id }, `Direction ${option.id} selected. Director notes and five-act plan are ready.`)} />)}</div></section>}

      {state?.tier === "premium" && <section className="rounded-xl border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Music2 className="size-4 text-primary" /> Music window</h3><p className="mt-1 text-xs text-muted-foreground">Choose the shorter emotional highlight or keep the complete track.</p></div>{state.selectedMusic && <Badge variant="outline">{state.selectedMusic.mode.replace("_", " ")} · {state.selectedMusic.source}</Badge>}</div>{state.selectedMusic?.preview && <p className="mt-3 text-sm text-muted-foreground">Suggested highlight: {formatSeconds(state.selectedMusic.preview.start)}–{formatSeconds(state.selectedMusic.preview.end)} ({Math.round(state.selectedMusic.preview.duration)}s)</p>}<div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => void act("music-highlight", "music", { mode: "highlight" }, "Highlight music window selected.")} disabled={busy !== null}>Use highlight</Button><Button size="sm" variant="outline" onClick={() => void act("music-full", "music", { mode: "full_song" }, "Full song selected.")} disabled={busy !== null}>Keep full song</Button></div>{state.selectedMusic?.reason && <p className="mt-3 text-xs leading-5 text-muted-foreground">{state.selectedMusic.reason}</p>}</section>}

      {state?.directorNotes && <section><div className="mb-3"><h3 className="text-sm font-semibold">What the AI decided</h3><p className="mt-1 text-xs text-muted-foreground">Guardrailed decisions recorded for audit, not just prose.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries({ ...(state.directorNotes.creative_brief || {}), ...(state.directorNotes.director_notes || {}) }).filter(([, value]) => typeof value === "string" || value === null).map(([key, value]) => <div key={key} className="rounded-lg border bg-card-soft p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{humanize(key)}</p><p className="mt-1 text-sm">{String(value ?? "None")}</p></div>)}</div></section>}

      {state?.storyPlan?.segments && <section><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Five-act story plan</h3><p className="mt-1 text-xs text-muted-foreground">Opening → Love Story → Ceremony → Family & Friends → Ending</p></div><Badge variant="outline"><Check className="mr-1 size-3" /> Ready for timeline</Badge></div><div className="grid gap-2 lg:grid-cols-5">{state.storyPlan.segments.map((segment, index) => <div key={segment.segment} className="rounded-lg border bg-background p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold">{index + 1}. {humanize(segment.segment)}</span><Badge variant="secondary">{segment.emphasis}</Badge></div><p className="mt-2 text-sm leading-5">{segment.goal}</p><p className="mt-3 text-xs text-muted-foreground">{segment.emotion} · {segment.pacing}</p><p className="mt-1 text-xs text-muted-foreground">Effect: {humanize(segment.priorityEffect)}</p></div>)}</div><p className="mt-3 text-xs text-muted-foreground">Use Job Runner → Dry run with Resume enabled to generate the director-aware timeline without rendering video.</p></section>}
    </CardContent>
  </Card>
}

function DirectionCard({ option, recommended, selected, disabled, onSelect }: { option: StoryDirection; recommended: boolean; selected: boolean; disabled: boolean; onSelect: () => void }) { return <button onClick={onSelect} disabled={disabled} className={cn("rounded-xl border p-4 text-left transition-colors", selected ? "border-primary bg-primary/5" : "bg-background hover:border-primary/50")}><div className="flex items-center gap-2"><span className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">{option.id}</span><span className="font-serif text-lg font-semibold">{option.title}</span>{recommended && <Badge variant="secondary" className="ml-auto">Recommended</Badge>}{selected && <Check className="ml-auto size-4 text-primary" />}</div><p className="mt-3 text-sm leading-6 text-muted-foreground">{option.summary}</p><p className="mt-3 text-xs"><span className="font-medium">Mood:</span> {option.mood} · {option.pacing}</p><p className="mt-2 text-xs text-muted-foreground">{option.emotionalArc}</p>{option.fitReason && <p className="mt-2 text-xs text-primary">Why it fits: {option.fitReason}</p>}</button> }
function humanize(value: string) { return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2") }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) }
function remaining(deadline: string, now: number) { const minutes = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 60_000)); return minutes > 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m left` : `${minutes}m left` }
function formatSeconds(value: number) { return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}` }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
