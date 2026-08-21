import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, ChevronDown, ChevronRight, Circle, Clock, Film, LoaderCircle, Minus, Play, Square } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost, subscribeToApiEvents } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { createSettlementTracker, recordJobStatus } from "@/lib/jobSettlement"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { jobStatusLabelKey, phaseLabelKey, phaseLongLabelKey } from "@/projectFormat"
import { strings, type StringKey } from "@/lib/strings"
import { TemplateMvpPanel } from "@/TemplateMvpPanel"
import type { JobSnapshot, ProjectSummary } from "@/types"

// Sentence forms live in `phaseLongLabelKey`, short chip forms in
// `phaseLabelKey`. Both maps exist so nothing ever falls back to the raw
// pipeline id — that is how customers ended up reading "Qa".
const phaseNames = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"] as const

export function JobRunnerPanel({ project, styleName, renderBlocked = false, blockedReason, onJobChanged, onEntitlementChanged }: {
  project: ProjectSummary
  styleName?: string | null
  renderBlocked?: boolean
  blockedReason?: string
  onJobChanged?: (job: JobSnapshot) => void
  /**
   * Fires whenever the account's render balance can have moved: on start (a
   * credit is held) and when a run finishes (a failed one is refunded by the
   * server). Without the second call the sidebar would keep showing the
   * charged-but-since-refunded number until the next full page load.
   */
  onEntitlementChanged?: () => void
}) {
  const { t } = useI18n()
  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const logEnd = useRef<HTMLDivElement>(null)

  // The server hands the credit back when a run reaches a terminal state, so
  // the balance in the sidebar has to be re-read — once per transition, not on
  // every snapshot the stream pushes, and never for the snapshot this panel
  // opens with. See `lib/jobSettlement.ts` for why that last clause matters.
  const settlement = useRef(createSettlementTracker())

  function commitJob(value: JobSnapshot) {
    setJob(value)
    onJobChanged?.(value)
    if (recordJobStatus(settlement.current, value.status)) onEntitlementChanged?.()
  }

  useEffect(() => {
    let active = true
    apiGet<JobSnapshot>(`/projects/${project.id}/job`).then((value) => {
      if (!active) return
      commitJob(value)
      // Seed the console from the tail the server persisted. Without this the
      // only record of a failure vanished the moment the page was reloaded.
      if (value.logTail?.length) setLogs(value.logTail)
    }).catch((reason: unknown) => { if (active) setError(apiMessage(reason, t)) })
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

  useEffect(() => { if (logOpen) logEnd.current?.scrollIntoView({ block: "nearest" }) }, [logs, logOpen])

  async function start(acceptMusicMismatch = false) {
    setSubmitting(true)
    setError(null)
    setLogs([])
    try {
      commitJob(await apiPost<JobSnapshot>(`/projects/${project.id}/job`, {
        mode: "render",
        resume: true,
        deliver: true,
        acceptMusicMismatch,
      }))
      onEntitlementChanged?.()
    } catch (reason) {
      setError(apiMessage(reason, t))
    } finally {
      setSubmitting(false)
    }
  }

  async function cancel() {
    setSubmitting(true)
    setError(null)
    try {
      commitJob(await apiPost<JobSnapshot>(`/projects/${project.id}/job/cancel`, {}))
    } catch (reason) {
      setError(apiMessage(reason, t))
    } finally {
      setSubmitting(false)
    }
  }

  // Queued counts as "in flight" for the button: the render was ordered and
  // paid for, so the action offered is Cancel, not a second Create that would
  // be refused as JOB_ALREADY_QUEUED.
  const queued = job?.status === "queued"
  const running = job?.status === "running" || job?.status === "pending"
  const inFlight = running || queued
  const progress = job?.progress || 0
  const progressTitle = job?.status === "completed" || job?.status === "completed_with_warning"
    ? t("job.filmReady")
    : job?.status === "failed"
      ? t("job.needsAttention")
      : job?.status === "paused"
        ? t("job.paused")
        : queued
          ? t("job.queued")
          : job?.currentPhase
            ? t(phaseLongLabelKey[job.currentPhase])
            : running ? t("job.startingPipeline") : t("job.readyToStart")
  const progressDetail = queued
    // 0 ahead means this is the next one to start, which is a different
    // sentence from "there are N in front of you" — a plural-aware "0 films
    // ahead" would be technically true and read as a bug.
    ? job?.queuePosition ? t("job.queuedAhead", { count: job.queuePosition }) : t("job.queuedNext")
    : running
      ? t("job.detailRunning")
      : job?.status === "completed" || job?.status === "completed_with_warning"
        ? t("job.detailCompleted")
        : job?.status === "failed"
          ? t("job.detailFailed")
          : job?.status === "paused"
            ? t("job.detailPaused")
            : t("job.detailIdle")

  return <><Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Film className="size-4 text-primary" /> {t("job.title")}</CardTitle><CardDescription className="mt-1">{t("job.description")}</CardDescription></div><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", connected ? "bg-success" : "bg-muted-foreground")} /><span className="text-xs text-muted-foreground">{connected ? t("job.live") : t("job.reconnecting")}</span>{job && <Badge variant="outline">{t(jobStatusLabelKey[job.status])}</Badge>}</div></div></CardHeader>
    {/* The log used to be the right half of a two-column grid, so a collapsed,
        empty console occupied half the card as a black slab. It is a disclosure,
        not a peer of the main content — it belongs at the bottom, sized to what
        it is actually showing. */}
    <CardContent className="p-0">
      <section className="p-6">
        {/* The page already carries a credit banner with the same wording and
            the same "View plans" button. Repeating the whole card here said it
            twice on one screen; the disabled button and its tooltip carry the
            reason at the point of action. */}
        <div className="rounded-lg border bg-background p-4 text-xs leading-5 text-muted-foreground">{renderBlocked ? blockedReason : t("job.runsOnItsOwn")}</div>
        {inFlight && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Clock className="size-3.5" /> {t("job.safeToLeave")}</p>}
        <div className="mt-6 flex gap-3">{inFlight ? <Button variant="outline" onClick={cancel} disabled={submitting}><Square className="size-4" /> {submitting ? t("job.stopping") : t("common.cancel")}</Button> : <Button onClick={() => void start()} disabled={submitting || renderBlocked} title={renderBlocked ? blockedReason : undefined}><Play className="size-4" /> {submitting ? t("job.starting") : job?.status === "paused" || job?.status === "failed" ? t("job.tryAgain") : t("job.createVideo")}</Button>}</div>
        {queued && <div className="mt-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><Clock className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{t("job.queued")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("job.queuedExplain")}</p></div></div>}
        {job?.status === "paused" && job.pauseReason?.startsWith("PLAYLIST_FIT_CONFIRMATION_REQUIRED:") && <PlaylistFitConfirmation reason={job.pauseReason} accepting={submitting} onAccept={() => void start(true)} />}
        {error && <p className="mt-4 flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
        {job?.status === "failed" && <FailureExplanation cause={job.cause} fallback={job.error} />}
        {job?.manuallyCompleted && <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text"><p className="font-medium">{t("job.finishedWithWarning")}</p><p className="mt-1 text-xs">{t("job.manualCompleteDetail")}</p></div>}
        {job?.warnings?.map((warning) => <div key={warning.code} className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-text"><p className="font-medium">{t("job.finishedWithWarning")}</p><p className="mt-1 text-xs">{warning.message}</p></div>)}
        <div className="mt-7 rounded-xl border bg-card-soft p-5" aria-live="polite">
          <div className="flex items-start justify-between gap-5">
            <div><p className="text-sm font-semibold">{progressTitle}</p><p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">{progressDetail}</p></div>
            <div className="shrink-0 text-right"><span className="font-serif text-4xl font-semibold tabular-nums">{progress}%</span><p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("job.complete")}</p></div>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full bg-primary transition-[width] duration-500", running && "animate-pulse")} style={{ width: `${progress}%` }} /></div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <Phase label={t("job.stage.prepare")} status={groupPhaseStatus(job, ["validate", "analyze", "plan"])} />
            <Phase label={t("job.stage.create")} status={groupPhaseStatus(job, ["build", "render"])} />
            <Phase label={t("job.stage.finish")} status={groupPhaseStatus(job, ["qa", "deliver"])} />
          </div>
        </div>
      </section>
      <section className="min-w-0 border-t bg-[#1f1c1a] px-5 py-4 text-[#eee8df]">
        <button type="button" onClick={() => setLogOpen((value) => !value)} aria-expanded={logOpen} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider">{logOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />} {t("job.technicalDetails")} <span className="font-normal normal-case text-[#a99f95]">{t("job.livePipelineOutput")}</span></span>
          <span className="shrink-0 text-[11px] text-[#a99f95]">{t("job.logLines", { count: logs.length })}</span>
        </button>
        {logOpen && <><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{phaseNames.map((phase) => <Phase key={phase} label={t(phaseLabelKey[phase])} status={job?.phases[phase] || "pending"} />)}</div><div className="mt-3 h-72 overflow-y-auto rounded-lg bg-black/25 p-4 font-mono text-xs leading-5">{logs.length ? logs.map((line, index) => <div key={`${index}-${line}`} className={line.startsWith("!") ? "text-red-300" : "text-[#d8d0c7]"}>{line}</div>) : <p className="text-[#8f867d]">{t("job.logEmpty")}</p>}<div ref={logEnd} /></div></>}
        {job?.error && <p className="mt-3 text-xs text-red-300">{job.error}</p>}
      </section>
    </CardContent>
  </Card><TemplateMvpPanel project={project} job={job} styleName={styleName} /></>
}

/**
 * What actually went wrong, in the reader's language, above the console rather
 * than inside it.
 *
 * The server recognises a handful of engine failures by their output and sends
 * back a `cause` code (see `server/services/failureCause.ts`); anything it
 * doesn't recognise falls back to the raw message, which is still better than
 * silence. Either way the stack trace stays where it belongs — behind
 * "Technical details".
 */
function FailureExplanation({ cause, fallback }: { cause: JobSnapshot["cause"]; fallback: string | null }) {
  const { t } = useI18n()
  const key = cause ? `jobCause.${cause.code}` : null
  const known = key && key in strings
  if (!known && !fallback) return null
  return <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
    <p className="flex items-center gap-2 font-medium text-destructive"><AlertCircle className="size-4 shrink-0" /> {t("job.whatWentWrong")}</p>
    {known
      ? <>
        <p className="mt-1.5 leading-6">{t(key as StringKey, cause?.params)}</p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{t(`jobCause.${cause!.code}.fix` as StringKey)}</p>
      </>
      : <p className="mt-1.5 break-words leading-6">{fallback}</p>}
  </div>
}

function groupPhaseStatus(job: JobSnapshot | null, phases: readonly (typeof phaseNames)[number][]) {
  const values = phases.map((phase) => job?.phases[phase] || "pending")
  if (values.includes("failed")) return "failed"
  if (values.includes("running")) return "running"
  if (values.every((value) => value === "completed" || value === "skipped")) return "completed"
  return "pending"
}

// A skipped phase used to share the completed styling — a green tick for work
// that was never done. It now reads as "not applicable" instead.
function Phase({ label, status }: { label: string; status: string }) {
  const { t } = useI18n()
  const Icon = status === "completed" ? Check : status === "skipped" ? Minus : status === "running" ? LoaderCircle : status === "failed" ? AlertCircle : Circle
  return <div
    className={cn("flex items-center gap-2 rounded-md px-2 py-1.5 text-xs", status === "running" && "bg-primary/10 text-primary", status === "failed" && "bg-destructive/10 text-destructive", status === "completed" && "text-success-text", status === "skipped" && "text-muted-foreground")}
    title={status === "skipped" ? t("job.phaseSkipped", { label }) : undefined}
  ><Icon className={cn("size-3.5 shrink-0", status === "running" && "animate-spin")} /> <span className="truncate">{label}</span></div>
}

function PlaylistFitConfirmation({ reason, accepting, onAccept }: { reason: string; accepting: boolean; onAccept: () => void }) {
  const { t } = useI18n()
  const [, mismatch, photos, duration, secondsPerPhoto] = reason.split(":")
  const tooLong = mismatch === "too_much_music"
  return <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning-text">
    <p className="font-medium">{t("job.playlistMismatch")}</p>
    <p className="mt-1 text-xs leading-5">{t("job.playlistMismatchDetail", { duration: Math.round(Number(duration)), photos: photos ?? "?", perPhoto: secondsPerPhoto ?? "?" })} {t(tooLong ? "job.playlistTooLong" : "job.playlistTooShort")}</p>
    <Button className="mt-3" size="sm" variant="outline" onClick={onAccept} disabled={accepting}><Play className="size-4" /> {accepting ? t("job.continuing") : t("job.continueAnyway")}</Button>
  </div>
}
