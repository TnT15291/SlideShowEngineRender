import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Circle, LoaderCircle, Play, RotateCcw, Square, Terminal } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost, subscribeToApiEvents } from "@/lib/api"
import { cn } from "@/lib/utils"
import { TemplateMvpPanel } from "@/TemplateMvpPanel"
import type { JobSnapshot, ProjectSummary } from "@/types"

const phaseNames = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"] as const
const phaseLabels: Record<(typeof phaseNames)[number], string> = {
  validate: "Validating project",
  analyze: "Analyzing media",
  plan: "Planning the story",
  build: "Building the timeline",
  render: "Rendering the film",
  qa: "Checking quality",
  deliver: "Preparing delivery",
}

export function JobRunnerPanel({ project, onJobChanged, onRenderStarted }: { project: ProjectSummary; onJobChanged?: (job: JobSnapshot) => void; onRenderStarted?: () => void }) {
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [mode, setMode] = useState<"dry_run" | "render" | "deliver">("dry_run")
  const [resume, setResume] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [connected, setConnected] = useState(false)
  const logEnd = useRef<HTMLDivElement>(null)

  function commitJob(value: JobSnapshot) {
    setJob(value)
    onJobChanged?.(value)
  }

  useEffect(() => {
    let active = true
    apiGet<JobSnapshot>(`/projects/${project.id}/job`).then((value) => { if (active) commitJob(value) }).catch((reason: unknown) => { if (active) setError(messageOf(reason)) })
    const unsubscribe = subscribeToApiEvents(`/projects/${project.id}/job/events`, {
      onOpen: () => { if (active) setConnected(true) },
      onError: () => { if (active) setConnected(false) },
      onEvent: (event) => {
      if (!active) return
        if (event.event === "snapshot") commitJob(JSON.parse(event.data) as JobSnapshot)
        if (event.event === "log") {
          const entry = JSON.parse(event.data) as { stream: string; line: string }
          setLogs((current) => [...current.slice(-199), `${entry.stream === "stderr" ? "!" : ">"} ${entry.line}`])
        }
      },
    })
    return () => { active = false; unsubscribe() }
  }, [project.id])

  useEffect(() => { logEnd.current?.scrollIntoView({ block: "nearest" }) }, [logs])

  async function start() {
    setSubmitting(true)
    setError(null)
    setLogs([])
    try {
      commitJob(await apiPost<JobSnapshot>(`/projects/${project.id}/job`, {
        mode: mode === "dry_run" ? "dry_run" : "render",
        resume,
        deliver: mode === "deliver",
      }))
      // A real render just consumed a subscription slot or a per-video credit server-side.
      if (mode !== "dry_run") onRenderStarted?.()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSubmitting(false)
    }
  }

  async function cancel() {
    setSubmitting(true)
    setError(null)
    try {
      commitJob(await apiPost<JobSnapshot>(`/projects/${project.id}/job/cancel`, {}))
      setResume(true)
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setSubmitting(false)
    }
  }

  const running = job?.status === "running" || job?.status === "pending"
  const progress = job?.progress || 0
  const progressTitle = job?.status === "completed" || job?.status === "completed_with_warning"
    ? "Your film is ready to review"
    : job?.status === "failed"
      ? "The pipeline needs attention"
      : job?.status === "paused"
        ? "The pipeline is paused"
        : job?.currentPhase
          ? phaseLabels[job.currentPhase]
          : running ? "Starting the pipeline" : "Ready to start"
  const progressDetail = running
    ? "Progress updates automatically. You can keep this page open while the film is being prepared."
    : job?.status === "completed" || job?.status === "completed_with_warning"
      ? "Processing is complete. The latest film is available in Render review below."
      : job?.status === "failed"
        ? "Check the error and live output, then run the pipeline again."
        : job?.status === "paused"
          ? "Run again with Resume enabled to continue from fresh completed phases."
          : "Choose a run mode and start the pipeline to create a review film."

  return <><Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Terminal className="size-4 text-primary" /> Job Runner</CardTitle><CardDescription className="mt-1">Run the project pipeline and follow its live state.</CardDescription></div><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", connected ? "bg-success" : "bg-muted-foreground")} /><span className="text-xs text-muted-foreground">{connected ? "Live" : "Reconnecting"}</span>{job && <Badge variant="outline" className="capitalize">{job.status.replace("_", " ")}</Badge>}</div></div></CardHeader>
    <CardContent className="p-0"><div className="grid lg:grid-cols-[.85fr_1.15fr]">
      <section className="border-b p-6 lg:border-b-0 lg:border-r"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Run mode<select className="field" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} disabled={running}><option value="dry_run">Dry run — no video render</option><option value="render">Render — full pipeline</option><option value="deliver">Render, QA & delivery</option></select></label><label className="flex items-center gap-3 self-end rounded-lg border bg-background px-3 py-2.5 text-sm"><input type="checkbox" checked={resume} onChange={(event) => setResume(event.target.checked)} disabled={running} className="size-4 accent-primary" /><span><span className="block font-medium">Resume</span><span className="text-xs text-muted-foreground">Reuse fresh phases</span></span></label></div>
        <div className="mt-6 flex gap-3">{running ? <Button variant="outline" onClick={cancel} disabled={submitting}><Square className="size-4" /> {submitting ? "Stopping…" : "Cancel job"}</Button> : <Button onClick={start} disabled={submitting}><Play className="size-4" /> {submitting ? "Starting…" : job?.status === "paused" || job?.status === "failed" ? "Run again" : "Start pipeline"}</Button>}{!running && job && job.status !== "not_started" && <Button variant="ghost" onClick={() => setResume(true)}><RotateCcw className="size-4" /> Resume mode</Button>}</div>
        {error && <p className="mt-4 flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
        {job?.warnings?.map((warning) => <div key={warning.code} className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">Video đã hoàn thành với một cảnh báo.</p><p className="mt-1 text-xs">{warning.message}</p></div>)}
        <div className="mt-7 rounded-xl border bg-card-soft p-5" aria-live="polite">
          <div className="flex items-start justify-between gap-5">
            <div><p className="text-sm font-semibold">{progressTitle}</p><p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{progressDetail}</p></div>
            <div className="shrink-0 text-right"><span className="font-serif text-4xl font-semibold tabular-nums">{progress}%</span><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">complete</p></div>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-primary transition-[width] duration-500", running && "animate-pulse")} style={{ width: `${progress}%` }} /></div>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">{phaseNames.map((phase) => <Phase key={phase} name={phase} status={job?.phases[phase] || "pending"} />)}</div>
        </div>
      </section>
      <section className="min-w-0 bg-[#1f1c1a] p-5 text-[#eee8df]"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider">Live output</p><span className="text-[11px] text-[#a99f95]">Last 200 lines</span></div><div className="h-72 overflow-y-auto rounded-lg bg-black/25 p-4 font-mono text-xs leading-5">{logs.length ? logs.map((line, index) => <div key={`${index}-${line}`} className={line.startsWith("!") ? "text-red-300" : "text-[#d8d0c7]"}>{line}</div>) : <p className="text-[#8f867d]">Pipeline output will appear here after the job starts.</p>}<div ref={logEnd} /></div>{job?.error && <p className="mt-3 text-xs text-red-300">{job.error}</p>}</section>
    </div></CardContent>
  </Card><TemplateMvpPanel project={project} job={job} /></>
}

function Phase({ name, status }: { name: string; status: string }) {
  const Icon = status === "completed" || status === "skipped" ? Check : status === "running" ? LoaderCircle : status === "failed" ? AlertCircle : Circle
  return <div className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-xs capitalize", status === "running" && "bg-primary/10 text-primary", status === "failed" && "bg-destructive/10 text-destructive", (status === "completed" || status === "skipped") && "text-success")}><Icon className={cn("size-3.5", status === "running" && "animate-spin")} /> {name}</div>
}

function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
