import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, CircleDashed, Eye, RefreshCw, ShieldCheck, Sparkles, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ProjectSummary, QaSnapshot } from "@/types"

export function AdvancedQaPanel({ project }: { project: ProjectSummary }) {
  const [qa, setQa] = useState<QaSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function refresh() {
    setLoading(true)
    try { setQa(await apiGet<QaSnapshot>(`/projects/${project.id}/qa`)); setError(null) }
    catch (reason) { setError(messageOf(reason)) } finally { setLoading(false) }
  }
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 4_000); return () => window.clearInterval(timer) }, [project.id])

  const running = qa?.status === "running" || qa?.status === "waiting"
  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" /> Advanced QA</CardTitle><CardDescription className="mt-1">Free pre-flight checks, rendered-frame checks, and bounded deterministic repair.</CardDescription></div><div className="flex items-center gap-2">{qa && <Badge className={verdictClass(qa)}>{statusLabel(qa)}</Badge>}<Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button></div></div></CardHeader>
    <CardContent className="space-y-5 p-6">
      {error && <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      {!qa?.ready && <div className="rounded-lg border border-dashed bg-card-soft p-5 text-sm text-muted-foreground">Generate a timeline first. Then run Render in Job Runner; its QA phase will populate this panel.</div>}
      {qa?.ready && <>
        <div className="grid gap-3 md:grid-cols-3">
          <Stage icon={CircleDashed} title="1. Pre-flight" active={qa.stage === "preflight"} value={`${qa.preflightPasses} pass${qa.preflightPasses === 1 ? "" : "es"}`} detail={`${qa.preflightFixes} free repair${qa.preflightFixes === 1 ? "" : "s"} · no revision budget`} warning={qa.preflightCapped ? "Safety cap reached" : null} />
          <Stage icon={Eye} title="2. Render checks" active={qa.stage === "render"} value={`${qa.clipProblems.length} frame issue${qa.clipProblems.length === 1 ? "" : "s"}`} detail="Brightness, empty frames, proxy and bookends" />
          <Stage icon={Wrench} title="3. Auto-revise" active={qa.stage === "revising"} value={`${qa.revisions}/${qa.maxRevisions} used`} detail={qa.stage === "revising" ? "Currently applying a deterministic repair" : "Each pass re-renders and spends budget"} />
        </div>

        {running && <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"><Sparkles className="size-4 animate-pulse text-primary" /><div><p className="font-medium">{qa.stage === "revising" ? "QA is automatically repairing the cut" : qa.stage === "preflight" ? "Pre-flight is checking pacing and hero choices" : qa.stage === "render" ? "QA is inspecting the rendered film" : "QA is waiting for its pipeline phase"}</p><p className="mt-1 text-xs text-muted-foreground">The job is active. This panel refreshes automatically.</p></div></div>}

        {qa.verdict === "unknown" && <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><p className="font-medium">Mechanical checks passed; subjective bookend verdict is unknown.</p><p className="mt-1 text-xs leading-5">{qa.visionReason || "Vision scoring was unavailable."} Unknown is not a pipeline failure.</p></div>}
        {qa.verdict === "ok" && <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> All enabled QA layers passed.</div>}
        {(qa.verdict === "review" || qa.status === "failed") && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-medium">{qa.status === "failed" ? "QA gate stopped the pipeline." : "Automatic repairs are exhausted; a person must review the current cut."}</p>{qa.error && <p className="mt-1 text-xs">{qa.error}</p>}</div>}

        {(qa.manualReview.length > 0 || qa.proxyProblems.length > 0 || qa.clipProblems.length > 0) && <section><h3 className="text-sm font-semibold">Findings</h3><div className="mt-3 space-y-2">{qa.manualReview.map((issue) => <Finding key={`manual-${issue}`} label="Manual review" value={issue} />)}{qa.clipProblems.map((issue) => <Finding key={`clip-${issue.id}-${issue.flags.join()}`} label="Rendered frame" value={`${issue.id}: ${issue.flags.join(", ")}`} />)}{qa.proxyProblems.map((issue) => <Finding key={`proxy-${issue.id}-${issue.check}`} label={humanize(issue.check)} value={`${issue.id}: ${issue.flags.join(", ")}${issue.detail ? ` — ${issue.detail}` : ""}`} />)}</div></section>}

        {qa.journal.length > 0 && <details className="rounded-lg border bg-card-soft p-4"><summary className="cursor-pointer text-sm font-medium">Repair journal · {qa.journal.length} change{qa.journal.length === 1 ? "" : "s"}</summary><div className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">{qa.journal.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}</div></details>}
        {qa.status === "not_started" && <p className="text-xs text-muted-foreground">Choose Render in Job Runner above. Dry run validates the timeline but intentionally skips rendered QA.</p>}
      </>}
    </CardContent>
  </Card>
}

function Stage({ icon: Icon, title, active, value, detail, warning }: { icon: typeof Eye; title: string; active: boolean; value: string; detail: string; warning?: string | null }) { return <div className={cn("rounded-xl border p-4", active ? "border-primary bg-primary/5" : "bg-background")}><div className="flex items-center gap-2 text-xs font-semibold"><Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} /> {title}</div><p className="mt-4 font-serif text-xl font-semibold">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>{warning && <p className="mt-2 text-xs font-medium text-destructive">{warning}</p>}</div> }
function Finding({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 rounded-lg border bg-background px-3 py-2 sm:grid-cols-[130px_1fr]"><span className="text-xs font-medium text-muted-foreground">{label}</span><span className="text-sm">{value}</span></div> }
function statusLabel(qa: QaSnapshot) { if (qa.status === "running") return qa.stage === "revising" ? "Auto-revising" : "QA running"; if (qa.status === "waiting") return "Waiting for QA"; if (qa.status === "failed") return "QA failed"; return qa.verdict || "Not run" }
function verdictClass(qa: QaSnapshot) { return qa.verdict === "ok" ? "border-0 bg-success text-white" : qa.verdict === "review" || qa.status === "failed" ? "border-0 bg-amber-500 text-white" : qa.verdict === "unknown" ? "border-0 bg-sky-600 text-white" : "" }
function humanize(value: string) { return value.replace(/_/g, " ") }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
