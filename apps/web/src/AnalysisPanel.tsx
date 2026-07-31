import { useCallback, useEffect, useState } from "react"
import { AlertCircle, BarChart3, Check, Eye, Image, LoaderCircle, Music2, Scissors, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n, type Translate } from "@/lib/i18n"
import type { StringKey } from "@/lib/strings"
import { cn } from "@/lib/utils"
import type { AnalysisSnapshot, ProjectAsset, ProjectSummary } from "@/types"

export function AnalysisPanel({ project, music = [] }: { project: ProjectSummary; music?: ProjectAsset[] }) {
  const { t } = useI18n()
  const [analysis, setAnalysis] = useState<AnalysisSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [visionApproved, setVisionApproved] = useState(false)
  const [keep, setKeep] = useState(1)
  const [cullApproved, setCullApproved] = useState(false)

  const reload = useCallback(() => {
    apiGet<AnalysisSnapshot>(`/projects/${project.id}/analysis`).then((value) => {
      setAnalysis(value)
      if (!value.cull && value.photos.technical > 0) setKeep(Math.max(1, Math.round(value.photos.technical * 0.75)))
    }).catch((reason: unknown) => setError(apiMessage(reason, t)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(reload, [reload])
  useEffect(() => {
    if (analysis?.run?.status !== "running") return
    const timer = setInterval(reload, 750)
    return () => clearInterval(timer)
  }, [analysis?.run?.status, reload])

  async function start(kind: "technical" | "vision") {
    setSubmitting(kind)
    setError(null)
    try { setAnalysis(await apiPost<AnalysisSnapshot>(`/projects/${project.id}/analysis`, { kind })) }
    catch (reason) { setError(apiMessage(reason, t)) }
    finally { setSubmitting(null) }
  }

  async function suggestCull() {
    setSubmitting("cull")
    setError(null)
    setCullApproved(false)
    try { setAnalysis(await apiPost<AnalysisSnapshot>(`/projects/${project.id}/analysis/cull`, { keep })) }
    catch (reason) { setError(apiMessage(reason, t)) }
    finally { setSubmitting(null) }
  }

  async function applyCull() {
    setSubmitting("apply")
    setError(null)
    try { setAnalysis(await apiPost<AnalysisSnapshot>(`/projects/${project.id}/analysis/cull/apply`, {})); setCullApproved(false) }
    catch (reason) { setError(apiMessage(reason, t)) }
    finally { setSubmitting(null) }
  }

  const running = analysis?.run?.status === "running"
  const technicalReady = Boolean(analysis && analysis.photos.technical > 0)
  const cullGroups = groupCullSuggestions(analysis?.cull?.drop || [], t)
  // The engine reports the stored name (`000000-<uuid>-Song.mp3`); show the
  // file the customer actually uploaded instead of our internal one.
  const uploadedNames = new Map(music.map((track) => [track.storedName, track.originalName]))
  const trackName = (file: string) => { const stored = file.split("/").pop() || file; return uploadedNames.get(stored) || stored }
  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" /> {t("analysis.title")}</CardTitle><CardDescription className="mt-1">{t("analysis.description")}</CardDescription></div>{analysis?.run && <Badge variant="outline" className="capitalize">{analysis.run.kind} · {analysis.run.status}</Badge>}</div></CardHeader>
    <CardContent className="space-y-6 p-6">
      {error && <p className="flex gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border p-5"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Image className="size-5" /></div><div className="min-w-0 flex-1"><h3 className="font-medium">{t("analysis.technical")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("analysis.technicalHint")}</p></div></div><div className="mt-5 grid grid-cols-3 gap-3 text-center"><Metric value={analysis?.photos.uploaded || 0} label={t("analysis.uploaded")} /><Metric value={analysis?.photos.technical || 0} label={t("analysis.analyzed")} /><Metric value={analysis?.music.filter((track) => track.status === "completed").length || 0} label={t("analysis.tracks")} /></div><Button className="mt-5" variant="outline" disabled={running || !analysis?.photos.uploaded} onClick={() => start("technical")}>{submitting === "technical" || running && analysis?.run?.kind === "technical" ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />} {t(technicalReady ? "analysis.rerunTechnical" : "analysis.runTechnical")}</Button></section>

        <section className="rounded-xl border p-5"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Eye className="size-5" /></div><div className="min-w-0 flex-1"><h3 className="font-medium">{t("analysis.vision")}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("analysis.visionHint", { model: analysis?.vision.model || t("analysis.configuredModel") })}</p></div></div>{analysis && <div className="mt-5 grid grid-cols-3 gap-3 text-center"><Metric value={analysis.vision.photoCount} label={t("analysis.photos")} /><Metric value={analysis.vision.requests} label={t("analysis.requests")} /><Metric value={analysis.vision.estimatedUsd ? `$${analysis.vision.estimatedUsd.low}–$${analysis.vision.estimatedUsd.high}` : "—"} label={t("analysis.estimatedUsd")} /></div>}<p className="mt-3 text-[11px] leading-4 text-muted-foreground">{analysis?.vision.pricingNote}</p><label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={visionApproved} onChange={(event) => setVisionApproved(event.target.checked)} /><span>{t("analysis.visionConsent", { count: analysis?.vision.photoCount || 0, provider: analysis?.vision.provider || t("analysis.provider") })}</span></label><Button className="mt-4" disabled={running || !technicalReady || !analysis?.vision.configured || !visionApproved} onClick={() => start("vision")}><Sparkles className="size-4" /> {submitting === "vision" ? t("analysis.starting") : t(analysis?.photos.generatedBy?.startsWith("vision:") ? "analysis.rerunVision" : "analysis.runVision")}</Button>{analysis && !analysis.vision.configured && <p className="mt-3 text-xs text-warning">{t("analysis.visionNotConfigured")}</p>}</section>
      </div>

      {analysis && analysis.music.length > 0 && <section><h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><Music2 className="size-4 text-primary" /> {t("analysis.music")}</h3><div className="grid gap-3 sm:grid-cols-2">{analysis.music.map((track) => <div key={track.file} className="flex items-center gap-3 rounded-lg border p-3"><span className={cn("grid size-8 place-items-center rounded-md", track.status === "completed" ? "bg-success/10 text-success" : track.status === "invalid" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{track.status === "completed" ? <Check className="size-4" /> : track.status === "invalid" ? <AlertCircle className="size-4" /> : <Music2 className="size-4" />}</span><div className="min-w-0"><p className="truncate text-sm font-medium" title={trackName(track.file)}>{trackName(track.file)}</p><p className="mt-0.5 text-xs text-muted-foreground">{track.status === "completed" ? `${formatDuration(track.duration || 0)} · ~${track.bpm} BPM` : track.error || t("analysis.waitingForTechnical")}</p></div></div>)}</div></section>}

      {technicalReady && <section className="rounded-xl border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="flex items-center gap-2 font-medium"><Scissors className="size-4 text-primary" /> {t("analysis.cull")}</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{t("analysis.cullHint")}</p></div><div className="flex items-end gap-2"><label className="text-xs font-medium">{t("analysis.photosToKeep")}<input type="number" min={1} max={analysis?.photos.technical || 1} value={keep} onChange={(event) => setKeep(Number(event.target.value))} className="field w-28" /></label><Button variant="outline" onClick={suggestCull} disabled={running || submitting === "cull"}><Scissors className="size-4" /> {t("analysis.suggest")}</Button></div></div>
        {analysis?.cull && <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_280px]"><div><div className="mb-3 flex items-center justify-between text-sm"><span>{t("analysis.proposedRemovals")}</span><span className="text-muted-foreground">{t("analysis.dropCount", { drop: analysis.cull.drop.length, total: analysis.cull.sourceCount })}</span></div>{analysis.cull.drop.length ? <div className="space-y-3">{cullGroups.map((group) => <details key={group.key} className="rounded-lg border bg-background"><summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3"><span><span className="text-sm font-medium">{group.label}</span><span className="ml-2 text-xs text-muted-foreground">{t("analysis.groupPhotos", { count: group.items.length })}</span></span><span className="text-xs text-primary">{t("common.review")}</span></summary><div className="divide-y border-t">{group.items.map((item) => <div key={item.file} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.file.split("/").pop()}</p><p className="mt-1 text-xs text-muted-foreground">{item.reason}</p></div>{typeof item.qualityNorm === "number" && <Badge variant="secondary" className="h-fit w-fit border-0">{t("analysis.quality", { percent: Math.round(item.qualityNorm * 100) })}</Badge>}</div>)}</div></details>)}</div> : <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t("analysis.nothingToRemove")}</p>}</div><aside className="h-fit rounded-lg bg-card-soft p-4 text-sm"><p><strong>{t("analysis.keptCount", { count: analysis.cull.keep })}</strong> · <strong>{t("analysis.protectedCount", { count: analysis.cull.locked.length })}</strong></p><p className="mt-2 text-xs leading-5 text-muted-foreground">{t("analysis.applyHint")}</p>{analysis.cull.shortfall && <p className="mt-2 text-warning">{t("analysis.shortfall", { count: analysis.cull.shortfall })}</p>}<label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={cullApproved} onChange={(event) => setCullApproved(event.target.checked)} /><span>{t("analysis.cullConsent")}</span></label><Button className="mt-4 w-full" onClick={applyCull} disabled={!cullApproved || submitting === "apply" || analysis.cull.drop.length === 0}>{t("analysis.applyCull")}</Button>{analysis.appliedCull && <p className="mt-3 flex items-center gap-1.5 text-xs text-success"><Check className="size-3.5" /> {t("analysis.cullApplied", { keep: analysis.appliedCull.keep, total: analysis.appliedCull.sourceCount })}</p>}</aside></div>}
      </section>}

      {analysis?.run && (analysis.run.logs.length > 0 || analysis.run.error) && <section><h3 className="mb-2 text-sm font-medium">{t("analysis.output")}</h3>{analysis.run.probeErrors.length > 0 && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"><p className="font-semibold">{t("analysis.probeErrors")}</p>{analysis.run.probeErrors.map((line) => <p key={line} className="mt-1 font-mono">{line}</p>)}</div>}<div className="max-h-56 overflow-y-auto rounded-lg bg-[#1f1c1a] p-4 font-mono text-xs leading-5 text-[#d8d0c7]">{analysis.run.logs.map((line, index) => <div key={`${index}-${line}`} className={line.startsWith("!") ? "text-red-300" : ""}>{line}</div>)}</div>{analysis.run.error && <p className="mt-2 text-xs text-destructive">{analysis.run.error}</p>}</section>}
    </CardContent>
  </Card>
}

function Metric({ value, label }: { value: string | number; label: string }) { return <div className="rounded-lg bg-card-soft px-2 py-3"><p className="font-serif text-lg font-semibold">{value}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div> }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}` }

// The `reason` strings these patterns match come from the engine and stay
// English; only the group headings a customer reads are translated.
function groupCullSuggestions(items: NonNullable<AnalysisSnapshot["cull"]>["drop"], t: Translate) {
  const groups: Array<{ key: StringKey; label: string; match: (item: typeof items[number]) => boolean; items: typeof items }> = [
    { key: "analysis.group.duplicates", label: t("analysis.group.duplicates"), match: (item) => Boolean(item.duplicateGroup) || /duplicate|similar/i.test(item.reason), items: [] },
    { key: "analysis.group.blur", label: t("analysis.group.blur"), match: (item) => /blur|sharp|quality|focus/i.test(item.reason), items: [] },
    { key: "analysis.group.exposure", label: t("analysis.group.exposure"), match: (item) => /expos|dark|bright|light|contrast/i.test(item.reason), items: [] },
    { key: "analysis.group.other", label: t("analysis.group.other"), match: () => true, items: [] },
  ]
  for (const item of items) groups.find((group) => group.match(item))?.items.push(item)
  return groups.filter((group) => group.items.length)
}
