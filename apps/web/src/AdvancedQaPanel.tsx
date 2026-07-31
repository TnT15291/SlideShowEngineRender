import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, CircleDashed, Eye, RefreshCw, ShieldCheck, Sparkles, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n, type Translate } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { ProjectSummary, QaSnapshot } from "@/types"

export function AdvancedQaPanel({ project }: { project: ProjectSummary }) {
  const { t } = useI18n()
  const [qa, setQa] = useState<QaSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accepting, setAccepting] = useState(false)
  async function refresh() {
    setLoading(true)
    try { setQa(await apiGet<QaSnapshot>(`/projects/${project.id}/qa`)); setError(null) }
    catch (reason) { setError(apiMessage(reason, t)) } finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 4_000); return () => window.clearInterval(timer) }, [project.id])
  async function completeManually() {
    setAccepting(true)
    setError(null)
    try {
      await apiPost(`/projects/${project.id}/job/complete-manually`, {})
      await refresh()
    } catch (reason) {
      setError(apiMessage(reason, t))
    } finally {
      setAccepting(false)
    }
  }

  const running = qa?.status === "running" || qa?.status === "waiting"
  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4 text-primary" /> {t("qa.title")}</CardTitle><CardDescription className="mt-1">{t("qa.description")}</CardDescription></div><div className="flex items-center gap-2">{qa && <Badge className={verdictClass(qa)}>{statusLabel(qa, t)}</Badge>}<Button variant="ghost" size="icon" aria-label={t("qa.refreshLabel")} onClick={() => void refresh()} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button></div></div></CardHeader>
    <CardContent className="space-y-5 p-6">
      {error && <p className="flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      {loading && !qa && <div className="rounded-lg border border-dashed bg-card-soft p-5 text-sm text-muted-foreground">{t("qa.loading")}</div>}
      {!loading && !qa?.ready && <div className="rounded-lg border border-dashed bg-card-soft p-5 text-sm text-muted-foreground">{t("qa.notReady")}</div>}
      {qa?.ready && <>
        <div className="grid gap-3 md:grid-cols-3">
          <Stage icon={CircleDashed} title={t("qa.stage.preflight")} active={qa.stage === "preflight"} value={t("qa.passes", { count: qa.preflightPasses })} detail={t("qa.freeRepairs", { count: qa.preflightFixes })} warning={qa.preflightCapped ? t("qa.safetyCap") : null} />
          <Stage icon={Eye} title={t("qa.stage.render")} active={qa.stage === "render"} value={t("qa.frameIssues", { count: qa.clipProblems.length })} detail={t("qa.frameIssuesDetail")} />
          <Stage icon={Wrench} title={t("qa.stage.revise")} active={qa.stage === "revising"} value={t("qa.revisionsUsed", { used: qa.revisions, max: qa.maxRevisions })} detail={t(qa.stage === "revising" ? "qa.revisingNow" : "qa.revisionCost")} />
        </div>

        {running && <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm"><Sparkles className="size-4 animate-pulse text-primary" /><div><p className="font-medium">{t(qa.stage === "revising" ? "qa.runningRevising" : qa.stage === "preflight" ? "qa.runningPreflight" : qa.stage === "render" ? "qa.runningRender" : "qa.runningWaiting")}</p><p className="mt-1 text-xs text-muted-foreground">{t("qa.runningDetail")}</p></div></div>}

        {qa.verdict === "unknown" && <div className="rounded-lg border border-info/30 bg-info/10 p-4 text-sm text-info"><p className="font-medium">{t("qa.unknownVerdict")}</p><p className="mt-1 text-xs leading-5">{qa.visionReason || t("qa.visionUnavailable")} {t("qa.unknownNotFailure")}</p></div>}
        {qa.verdict === "ok" && <div className="flex gap-2 rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /> {t("qa.allPassed")}</div>}
        {(qa.verdict === "review" || qa.status === "failed" || qa.canCompleteManually || qa.manualAccepted) && <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning"><p className="font-medium">{t(qa.manualAccepted ? "qa.manuallyAccepted" : qa.status === "failed" ? "qa.gateStopped" : qa.canCompleteManually ? "qa.canCompleteManually" : "qa.repairsExhausted")}</p>{qa.error && <p className="mt-1 text-xs">{qa.error}</p>}{qa.canCompleteManually && <Button className="mt-3" size="sm" variant="outline" onClick={() => void completeManually()} disabled={accepting}><CheckCircle2 className="size-4" /> {accepting ? t("qa.confirming") : t("qa.confirmManual")}</Button>}</div>}

        {(qa.manualReview.length > 0 || qa.proxyProblems.length > 0 || qa.clipProblems.length > 0) && <section><h3 className="text-sm font-semibold">{t("qa.findings")}</h3><div className="mt-3 space-y-2">{qa.manualReview.map((issue) => <Finding key={`manual-${issue}`} label={t("qa.manualReview")} value={issue} />)}{qa.clipProblems.map((issue) => <Finding key={`clip-${issue.id}-${issue.flags.join()}`} label={t("qa.renderedFrame")} value={`${issue.id}: ${issue.flags.join(", ")}`} />)}{qa.proxyProblems.map((issue) => <Finding key={`proxy-${issue.id}-${issue.check}`} label={humanize(issue.check)} value={`${issue.id}: ${issue.flags.join(", ")}${issue.detail ? ` — ${issue.detail}` : ""}`} />)}</div></section>}

        {qa.journal.length > 0 && <details className="rounded-lg border bg-card-soft p-4"><summary className="cursor-pointer text-sm font-medium">{t("qa.journal", { count: qa.journal.length })}</summary><div className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">{qa.journal.map((entry, index) => <p key={`${index}-${entry}`}>{entry}</p>)}</div></details>}
        {qa.status === "not_started" && <p className="text-xs text-muted-foreground">{t("qa.runsAutomatically")}</p>}
      </>}
    </CardContent>
  </Card>
}

function Stage({ icon: Icon, title, active, value, detail, warning }: { icon: typeof Eye; title: string; active: boolean; value: string; detail: string; warning?: string | null }) { return <div className={cn("rounded-xl border p-4", active ? "border-primary bg-primary/5" : "bg-background")}><div className="flex items-center gap-2 text-xs font-semibold"><Icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} /> {title}</div><p className="mt-4 font-serif text-xl font-semibold">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>{warning && <p className="mt-2 text-xs font-medium text-destructive">{warning}</p>}</div> }
function Finding({ label, value }: { label: string; value: string }) { return <div className="grid gap-1 rounded-lg border bg-background px-3 py-2 sm:grid-cols-[130px_1fr]"><span className="text-xs font-medium text-muted-foreground">{label}</span><span className="text-sm">{value}</span></div> }
function statusLabel(qa: QaSnapshot, t: Translate) {
  if (qa.status === "running") return t(qa.stage === "revising" ? "qa.autoRevising" : "qa.running")
  if (qa.status === "waiting") return t("qa.waiting")
  if (qa.status === "failed") return t("qa.failed")
  // `verdict` is one of ok / review / unknown, or absent before the first run.
  if (qa.verdict === "ok" || qa.verdict === "review" || qa.verdict === "unknown") return t(`qaVerdict.${qa.verdict}`)
  return t("qa.notRun")
}
function verdictClass(qa: QaSnapshot) { return qa.verdict === "ok" ? "border-0 bg-success text-success-foreground" : qa.verdict === "review" || qa.status === "failed" ? "border-0 bg-warning text-warning-foreground" : qa.verdict === "unknown" ? "border-0 bg-info text-info-foreground" : "" }
function humanize(value: string) { return value.replace(/_/g, " ") }
