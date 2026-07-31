import { useEffect, useState } from "react"
import { AlertTriangle, History, Loader2, MessageSquareText, RotateCcw, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiGet, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n, type Translate } from "@/lib/i18n"
import type { ProjectSummary, RevisionResult, RevisionSnapshot } from "@/types"

const maxRounds = 2

export function RevisionPanel({ project, onChanged }: { project: ProjectSummary; onChanged: () => Promise<void> }) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState<RevisionSnapshot | null>(null)
  const [request, setRequest] = useState("")
  const [preview, setPreview] = useState<RevisionResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [undoRound, setUndoRound] = useState<number | null>(null)
  const [busy, setBusy] = useState<"preview" | "apply" | "undo" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    try { setSnapshot(await apiGet<RevisionSnapshot>(`/projects/${project.id}/revisions?maxRounds=${maxRounds}`)) }
    catch (reason) { setError(apiMessage(reason, t)) }
  }

  useEffect(() => { setPreview(null); setRequest(""); setConfirmed(false); void refresh() }, [project.id])

  async function previewRequest() {
    if (!request.trim()) return
    setBusy("preview"); setError(null); setNotice(null); setConfirmed(false)
    try { setPreview(await apiPost<RevisionResult>(`/projects/${project.id}/revisions/preview`, { request, maxRounds })) }
    catch (reason) { setError(apiMessage(reason, t)); setPreview(null) } finally { setBusy(null) }
  }

  async function applyRequest() {
    if (!preview || (preview.requiresRestory && !confirmed)) return
    setBusy("apply"); setError(null)
    try {
      const result = await apiPost<RevisionResult>(`/projects/${project.id}/revisions/apply`, { request, maxRounds, confirmRestory: confirmed })
      setSnapshot(result.snapshot); setPreview(null); setRequest(""); setConfirmed(false)
      setNotice(t("revision.applied", { round: result.round ?? "" }))
      await onChanged()
    } catch (reason) { setError(apiMessage(reason, t)) } finally { setBusy(null) }
  }

  async function undo() {
    if (undoRound === null) return
    setBusy("undo"); setError(null)
    try {
      const result = await apiPost<RevisionResult>(`/projects/${project.id}/revisions/undo`, { round: undoRound, maxRounds })
      setSnapshot(result.snapshot); setUndoRound(null); setPreview(null)
      setNotice(t("revision.undone", { round: undoRound }))
      await onChanged()
    } catch (reason) { setError(apiMessage(reason, t)) } finally { setBusy(null) }
  }

  return <section className="mb-6 rounded-xl border bg-card-soft p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="size-4 text-primary" /> {t("revision.title")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("revision.description")}</p></div>
      <Badge variant="outline">{t("revision.roundsLeft", { remaining: snapshot?.remainingRounds ?? maxRounds, max: maxRounds })}</Badge>
    </div>
    <textarea value={request} onChange={(event) => { setRequest(event.target.value); setPreview(null); setConfirmed(false) }} placeholder={t("revision.placeholder")} rows={3} className="mt-4 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
    <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void previewRequest()} disabled={!request.trim() || busy !== null || (snapshot?.remainingRounds ?? 1) === 0}><Sparkles className="size-4" /> {busy === "preview" ? t("revision.previewing") : t("revision.preview")}</Button>{preview && <Button variant="outline" onClick={() => void applyRequest()} disabled={busy !== null || (preview.requiresRestory && !confirmed)}>{busy === "apply" && <Loader2 className="size-4 animate-spin" />} {t("revision.apply")}</Button>}</div>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    {notice && <p className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">{notice}</p>}
    {preview && <div className="mt-4 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{t("revision.proposedRound", { round: preview.round ?? "" })}</span>{preview.blastRadius && <Badge variant="outline">{radiusLabel(preview.blastRadius, t)}</Badge>}{preview.destructive && <Badge className="bg-destructive text-destructive-foreground">{t("revision.destructive")}</Badge>}</div>
      {(preview.destructive || preview.requiresRestory) && <div className="mt-3 flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div>{t(preview.requiresRestory ? "revision.restoryWarning" : "revision.destructiveWarning")}</div></div>}
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-[#1f1c1a] p-3 text-xs leading-5 text-[#eee8df]">{preview.output}</pre>
      {preview.requiresRestory && <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 size-4" /><span>{t("revision.restoryConfirm")}</span></label>}
    </div>}
    {snapshot && snapshot.rounds.length > 0 && <div className="mt-5 border-t pt-4"><h4 className="flex items-center gap-2 text-sm font-medium"><History className="size-4" /> {t("revision.history")}</h4><div className="mt-3 space-y-2">{snapshot.rounds.map((round) => <div key={round.round} className="rounded-lg border bg-background p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-semibold">{t("revision.round", { round: round.round })}</span><Badge variant="outline">{round.status}</Badge></div>{round.directives.map((directive) => <p key={directive.id} className="mt-1 text-sm text-muted-foreground">“{directive.quote}”</p>)}</div>{round.undoable && (undoRound === round.round ? <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t("revision.undoQuestion")}</span><Button size="sm" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void undo()} disabled={busy !== null}>{t("common.confirm")}</Button><Button size="sm" variant="outline" onClick={() => setUndoRound(null)}>{t("common.cancel")}</Button></div> : <Button size="sm" variant="ghost" onClick={() => setUndoRound(round.round)}><RotateCcw className="size-3.5" /> {t("revision.undo")}</Button>)}</div></div>)}</div></div>}
  </section>
}

function radiusLabel(radius: NonNullable<RevisionResult["blastRadius"]>, t: Translate) {
  return t(radius === "timeline" ? "revision.radius.timeline" : radius === "build" ? "revision.radius.build" : "revision.radius.restory")
}
