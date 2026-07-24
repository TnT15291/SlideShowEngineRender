import { useCallback, useEffect, useState } from "react"
import { AlertCircle, BarChart3, Check, Eye, Image, LoaderCircle, Music2, Scissors, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { AnalysisSnapshot, ProjectSummary } from "@/types"

export function AnalysisPanel({ project }: { project: ProjectSummary }) {
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
    }).catch((reason: unknown) => setError(messageOf(reason)))
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
    catch (reason) { setError(messageOf(reason)) }
    finally { setSubmitting(null) }
  }

  async function suggestCull() {
    setSubmitting("cull")
    setError(null)
    setCullApproved(false)
    try { setAnalysis(await apiPost<AnalysisSnapshot>(`/projects/${project.id}/analysis/cull`, { keep })) }
    catch (reason) { setError(messageOf(reason)) }
    finally { setSubmitting(null) }
  }

  async function applyCull() {
    setSubmitting("apply")
    setError(null)
    try { setAnalysis(await apiPost<AnalysisSnapshot>(`/projects/${project.id}/analysis/cull/apply`, {})); setCullApproved(false) }
    catch (reason) { setError(messageOf(reason)) }
    finally { setSubmitting(null) }
  }

  const running = analysis?.run?.status === "running"
  const technicalReady = Boolean(analysis && analysis.photos.technical > 0)
  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="size-4 text-primary" /> Photos & Music Analysis</CardTitle><CardDescription className="mt-1">Technical measurements are local. Vision is optional, priced, and requires confirmation.</CardDescription></div>{analysis?.run && <Badge variant="outline" className="capitalize">{analysis.run.kind} · {analysis.run.status}</Badge>}</div></CardHeader>
    <CardContent className="space-y-6 p-6">
      {error && <p className="flex gap-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border p-5"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Image className="size-5" /></div><div className="min-w-0 flex-1"><h3 className="font-medium">Technical analysis</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Local FFmpeg/FFprobe pass for dimensions, sharpness, exposure, faces, duplicates, and music rhythm.</p></div></div><div className="mt-5 grid grid-cols-3 gap-3 text-center"><Metric value={analysis?.photos.uploaded || 0} label="Uploaded" /><Metric value={analysis?.photos.technical || 0} label="Analyzed" /><Metric value={analysis?.music.filter((track) => track.status === "completed").length || 0} label="Tracks" /></div><Button className="mt-5" variant="outline" disabled={running || !analysis?.photos.uploaded} onClick={() => start("technical")}>{submitting === "technical" || running && analysis?.run?.kind === "technical" ? <LoaderCircle className="size-4 animate-spin" /> : <BarChart3 className="size-4" />} {technicalReady ? "Re-run technical analysis" : "Analyze photos & music"}</Button></section>

        <section className="rounded-xl border p-5"><div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Eye className="size-5" /></div><div className="min-w-0 flex-1"><h3 className="font-medium">Vision analysis</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Semantic tags, emotion and story importance using {analysis?.vision.model || "the configured model"}.</p></div></div>{analysis && <div className="mt-5 grid grid-cols-3 gap-3 text-center"><Metric value={analysis.vision.photoCount} label="Photos" /><Metric value={analysis.vision.requests} label="Requests" /><Metric value={analysis.vision.estimatedUsd ? `$${analysis.vision.estimatedUsd.low}–$${analysis.vision.estimatedUsd.high}` : "—"} label="Est. USD" /></div>}<p className="mt-3 text-[11px] leading-4 text-muted-foreground">{analysis?.vision.pricingNote}</p><label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={visionApproved} onChange={(event) => setVisionApproved(event.target.checked)} /><span>I reviewed this estimate and approve sending {analysis?.vision.photoCount || 0} photo previews to {analysis?.vision.provider || "the provider"}.</span></label><Button className="mt-4" disabled={running || !technicalReady || !analysis?.vision.configured || !visionApproved} onClick={() => start("vision")}><Sparkles className="size-4" /> {submitting === "vision" ? "Starting…" : analysis?.photos.generatedBy?.startsWith("vision:") ? "Re-run vision" : "Run vision analysis"}</Button>{analysis && !analysis.vision.configured && <p className="mt-3 text-xs text-amber-700">Configure a vision-capable provider and API key before running this paid step.</p>}</section>
      </div>

      {analysis && analysis.music.length > 0 && <section><h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><Music2 className="size-4 text-primary" /> Music analysis</h3><div className="grid gap-3 sm:grid-cols-2">{analysis.music.map((track) => <div key={track.file} className="flex items-center gap-3 rounded-lg border p-3"><span className={cn("grid size-8 place-items-center rounded-md", track.status === "completed" ? "bg-success/10 text-success" : track.status === "invalid" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{track.status === "completed" ? <Check className="size-4" /> : track.status === "invalid" ? <AlertCircle className="size-4" /> : <Music2 className="size-4" />}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{track.file.split("/").pop()}</p><p className="mt-0.5 text-xs text-muted-foreground">{track.status === "completed" ? `${formatDuration(track.duration || 0)} · ~${track.bpm} BPM` : track.error || "Waiting for technical analysis"}</p></div></div>)}</div></section>}

      {technicalReady && <section className="rounded-xl border p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="flex items-center gap-2 font-medium"><Scissors className="size-4 text-primary" /> Cull advisor</h3><p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Generate a reviewable proposal. No source photo is deleted, and selection changes only after Apply.</p></div><div className="flex items-end gap-2"><label className="text-xs font-medium">Photos to keep<input type="number" min={1} max={analysis?.photos.technical || 1} value={keep} onChange={(event) => setKeep(Number(event.target.value))} className="field w-28" /></label><Button variant="outline" onClick={suggestCull} disabled={running || submitting === "cull"}><Scissors className="size-4" /> Suggest</Button></div></div>
        {analysis?.cull && <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_260px]"><div><div className="mb-2 flex items-center justify-between text-sm"><span>Proposed removals</span><span className="text-muted-foreground">{analysis.cull.drop.length} of {analysis.cull.sourceCount}</span></div><div className="max-h-64 divide-y overflow-y-auto rounded-lg border">{analysis.cull.drop.length ? analysis.cull.drop.map((item) => <div key={item.file} className="p-3"><p className="truncate text-sm font-medium">{item.file.split("/").pop()}</p><p className="mt-1 text-xs text-muted-foreground">{item.reason}</p></div>) : <p className="p-4 text-sm text-muted-foreground">Nothing needs to be removed.</p>}</div></div><aside className="rounded-lg bg-card-soft p-4 text-sm"><p><strong>{analysis.cull.keep}</strong> kept · <strong>{analysis.cull.locked.length}</strong> protected</p>{analysis.cull.shortfall && <p className="mt-2 text-amber-700">Short by {analysis.cull.shortfall}; locked photos remain protected.</p>}<label className="mt-4 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={cullApproved} onChange={(event) => setCullApproved(event.target.checked)} /><span>I reviewed the proposed list. Apply it to the selected-photo file.</span></label><Button className="mt-4 w-full" onClick={applyCull} disabled={!cullApproved || submitting === "apply" || analysis.cull.drop.length === 0}>Apply cull</Button>{analysis.appliedCull && <p className="mt-3 flex items-center gap-1.5 text-xs text-success"><Check className="size-3.5" /> Applied: {analysis.appliedCull.keep}/{analysis.appliedCull.sourceCount} selected</p>}</aside></div>}
      </section>}

      {analysis?.run && (analysis.run.logs.length > 0 || analysis.run.error) && <section><h3 className="mb-2 text-sm font-medium">Analysis output</h3>{analysis.run.probeErrors.length > 0 && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"><p className="font-semibold">Media probe errors</p>{analysis.run.probeErrors.map((line) => <p key={line} className="mt-1 font-mono">{line}</p>)}</div>}<div className="max-h-56 overflow-y-auto rounded-lg bg-[#1f1c1a] p-4 font-mono text-xs leading-5 text-[#d8d0c7]">{analysis.run.logs.map((line, index) => <div key={`${index}-${line}`} className={line.startsWith("!") ? "text-red-300" : ""}>{line}</div>)}</div>{analysis.run.error && <p className="mt-2 text-xs text-destructive">{analysis.run.error}</p>}</section>}
    </CardContent>
  </Card>
}

function Metric({ value, label }: { value: string | number; label: string }) { return <div className="rounded-lg bg-card-soft px-2 py-3"><p className="font-serif text-lg font-semibold">{value}</p><p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div> }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}` }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
