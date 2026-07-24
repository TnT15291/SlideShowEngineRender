import { useEffect, useState } from "react"
import { AlertTriangle, History, Loader2, MessageSquareText, RotateCcw, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiGet, apiPost } from "@/lib/api"
import type { ProjectSummary, RevisionResult, RevisionSnapshot } from "@/types"

const maxRounds = 2

export function RevisionPanel({ project, onChanged }: { project: ProjectSummary; onChanged: () => Promise<void> }) {
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
    catch (reason) { setError(messageOf(reason)) }
  }

  useEffect(() => { setPreview(null); setRequest(""); setConfirmed(false); void refresh() }, [project.id])

  async function previewRequest() {
    if (!request.trim()) return
    setBusy("preview"); setError(null); setNotice(null); setConfirmed(false)
    try { setPreview(await apiPost<RevisionResult>(`/projects/${project.id}/revisions/preview`, { request, maxRounds })) }
    catch (reason) { setError(messageOf(reason)); setPreview(null) } finally { setBusy(null) }
  }

  async function applyRequest() {
    if (!preview || (preview.requiresRestory && !confirmed)) return
    setBusy("apply"); setError(null)
    try {
      const result = await apiPost<RevisionResult>(`/projects/${project.id}/revisions/apply`, { request, maxRounds, confirmRestory: confirmed })
      setSnapshot(result.snapshot); setPreview(null); setRequest(""); setConfirmed(false)
      setNotice(`Round ${result.round ?? ""} applied. The affected pipeline phases and old delivery preview are now stale.`)
      await onChanged()
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(null) }
  }

  async function undo() {
    if (undoRound === null) return
    setBusy("undo"); setError(null)
    try {
      const result = await apiPost<RevisionResult>(`/projects/${project.id}/revisions/undo`, { round: undoRound, maxRounds })
      setSnapshot(result.snapshot); setUndoRound(null); setPreview(null)
      setNotice(`Round ${undoRound} withdrawn. Re-run the pipeline to produce the restored cut.`)
      await onChanged()
    } catch (reason) { setError(messageOf(reason)) } finally { setBusy(null) }
  }

  return <section className="mb-6 rounded-xl border bg-card-soft p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="size-4 text-primary" /> Ask the AI director for a revision</h3><p className="mt-1 text-xs text-muted-foreground">Describe the change in plain language. Preview shows its reach before anything is changed.</p></div>
      <Badge variant="outline">{snapshot?.remainingRounds ?? maxRounds} of {maxRounds} rounds left</Badge>
    </div>
    <textarea value={request} onChange={(event) => { setRequest(event.target.value); setPreview(null); setConfirmed(false) }} placeholder="E.g. Remove the caption in scene 12, slow down the family chapter, and use a film-page transition…" rows={3} className="mt-4 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
    <div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void previewRequest()} disabled={!request.trim() || busy !== null || (snapshot?.remainingRounds ?? 1) === 0}><Sparkles className="size-4" /> {busy === "preview" ? "Previewing…" : "Preview changes"}</Button>{preview && <Button variant="outline" onClick={() => void applyRequest()} disabled={busy !== null || (preview.requiresRestory && !confirmed)}>{busy === "apply" && <Loader2 className="size-4 animate-spin" />} Apply revision</Button>}</div>
    {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
    {notice && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{notice}</p>}
    {preview && <div className="mt-4 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">Proposed round {preview.round}</span>{preview.blastRadius && <Badge variant="outline">{radiusLabel(preview.blastRadius)}</Badge>}{preview.destructive && <Badge className="bg-destructive text-destructive-foreground">Scenes or text removed</Badge>}</div>
      {(preview.destructive || preview.requiresRestory) && <div className="mt-3 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div>{preview.requiresRestory ? "This is a re-telling: acts, words, and photos may all change. The engine cannot promise an exact scene diff before rebuilding." : "This change removes the scenes or exact text listed below."}</div></div>}
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">{preview.output}</pre>
      {preview.requiresRestory && <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 size-4" /><span>I understand this creates a new telling of the film, not a narrow edit.</span></label>}
    </div>}
    {snapshot && snapshot.rounds.length > 0 && <div className="mt-5 border-t pt-4"><h4 className="flex items-center gap-2 text-sm font-medium"><History className="size-4" /> Revision history</h4><div className="mt-3 space-y-2">{snapshot.rounds.map((round) => <div key={round.round} className="rounded-lg border bg-background p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="text-xs font-semibold">Round {round.round}</span><Badge variant="outline">{round.status}</Badge></div>{round.directives.map((directive) => <p key={directive.id} className="mt-1 text-sm text-muted-foreground">“{directive.quote}”</p>)}</div>{round.undoable && (undoRound === round.round ? <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Undo this round?</span><Button size="sm" className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => void undo()} disabled={busy !== null}>Confirm</Button><Button size="sm" variant="outline" onClick={() => setUndoRound(null)}>Cancel</Button></div> : <Button size="sm" variant="ghost" onClick={() => setUndoRound(round.round)}><RotateCcw className="size-3.5" /> Undo</Button>)}</div></div>)}</div></div>}
  </section>
}

function radiusLabel(radius: NonNullable<RevisionResult["blastRadius"]>) { return radius === "timeline" ? "Timeline only" : radius === "build" ? "Rebuild from story" : "Re-story film" }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
