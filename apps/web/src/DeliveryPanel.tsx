import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Check, Copy, Download, Film, Globe, Lock, LockKeyhole, PackageCheck, RefreshCw, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiBlob, apiDelete, apiGet, apiPost, downloadApiFile } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { intlLocales, useI18n, type Locale, type Translate } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { artifactLabelKey } from "@/projectFormat"
import type { DeliverySnapshot, ProjectArtifact, ProjectSummary } from "@/types"

export function DeliveryPanel({ project }: { project: ProjectSummary }) {
  const { t, locale } = useI18n()
  const [delivery, setDelivery] = useState<DeliverySnapshot | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState(project.shared)
  const [copied, setCopied] = useState(false)

  async function refresh() {
    try { setDelivery(await apiGet<DeliverySnapshot>(`/projects/${project.id}/delivery`)); setError(null) }
    catch (reason) { setError(apiMessage(reason, t)) }
  }
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5_000); return () => window.clearInterval(timer) }, [project.id])
  const byId = useMemo(() => new Map(delivery?.artifacts.map((item) => [item.id, item]) || []), [delivery])
  const preview = byId.get("preview"), thumbnail = byId.get("thumbnail"), master = byId.get("delivery"), summaryArtifact = byId.get("summary")

  useEffect(() => {
    let active = true, previewObject: string | null = null, thumbObject: string | null = null
    setPreviewUrl(null); setThumbnailUrl(null)
    if (preview?.ready) apiBlob(preview.url).then((blob) => { if (active) { previewObject = URL.createObjectURL(blob); setPreviewUrl(previewObject) } }).catch((reason) => { if (active) setError(apiMessage(reason, t)) })
    if (thumbnail?.ready) apiBlob(thumbnail.url).then((blob) => { if (active) { thumbObject = URL.createObjectURL(blob); setThumbnailUrl(thumbObject) } }).catch(() => undefined)
    return () => { active = false; if (previewObject) URL.revokeObjectURL(previewObject); if (thumbObject) URL.revokeObjectURL(thumbObject) }
  }, [preview?.url, preview?.updatedAt, preview?.ready, thumbnail?.url, thumbnail?.updatedAt, thumbnail?.ready])

  async function action(name: "approve" | "release") {
    setBusy(name); setError(null)
    try { setDelivery(await apiPost<DeliverySnapshot>(`/projects/${project.id}/delivery/${name}`, {})) }
    catch (reason) { setError(apiMessage(reason, t)) } finally { setBusy(null) }
  }
  async function download(artifact: ProjectArtifact, filename: string) {
    setBusy(`download-${artifact.id}`); setError(null)
    try { await downloadApiFile(artifact.url, filename) } catch (reason) { setError(apiMessage(reason, t)) } finally { setBusy(null) }
  }
  async function toggleShare() {
    setBusy("share"); setError(null)
    try {
      const updated = shared
        ? await apiDelete<ProjectSummary>(`/projects/${project.id}/share`)
        : await apiPost<ProjectSummary>(`/projects/${project.id}/share`, {})
      setShared(updated.shared)
    } catch (reason) { setError(apiMessage(reason, t)) } finally { setBusy(null) }
  }
  const galleryLink = `${window.location.origin}/?view=gallery`
  async function copyLink() {
    try { await navigator.clipboard.writeText(galleryLink); setCopied(true); window.setTimeout(() => setCopied(false), 2_000) }
    catch (reason) { setError(apiMessage(reason, t)) }
  }

  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="size-4 text-primary" /> {t("delivery.title")}</CardTitle><CardDescription className="mt-1">{t("delivery.description")}</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="size-4" /> {t("common.refresh")}</Button></div></CardHeader>
    <CardContent className="space-y-6 p-6">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {delivery?.approval.status === "invalidated" && <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">{t("delivery.approvalInvalid")}</p><p className="mt-1 text-xs">{t("delivery.approvalInvalidDetail", { reason: delivery.approval.reason ?? "" })}</p></div></div>}
      <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        <section className="min-w-0"><div className="aspect-video overflow-hidden rounded-xl border bg-black">{previewUrl ? <video className="h-full w-full" controls preload="metadata" poster={thumbnailUrl || undefined}><source src={previewUrl} type="video/mp4" /></video> : <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/60"><Film className="size-8" /><span>{t(preview?.stale ? "delivery.previewStale" : "delivery.previewMissing")}</span></div>}</div><div className="mt-3 flex flex-wrap items-center gap-2">{delivery?.summary?.preview?.watermark && <Badge variant="outline">{t("delivery.watermark", { value: delivery.summary.preview.watermark })}</Badge>}{delivery?.summary?.preview?.durationSec != null && <Badge variant="outline">{formatDuration(delivery.summary.preview.durationSec)}</Badge>}{preview?.stale && <Badge className="bg-warning text-warning-foreground">{t("common.stale")}</Badge>}</div></section>
        <section><h3 className="text-sm font-semibold">{t("delivery.checklist")}</h3><div className="mt-3 space-y-2"><CheckRow done={Boolean(preview?.ready)} label={t("delivery.check.preview")} /><CheckRow done={delivery?.approval.status === "approved"} label={t("delivery.check.approved")} /><CheckRow done={Boolean(master?.ready)} label={t("delivery.check.master")} /><CheckRow done={Boolean(delivery?.release)} label={t("delivery.check.released")} /></div><div className="mt-5 space-y-2">{delivery?.approval.status !== "approved" ? <Button className="w-full" onClick={() => void action("approve")} disabled={!preview?.ready || busy !== null}><ShieldCheck className="size-4" /> {busy === "approve" ? t("delivery.approving") : t("delivery.approve")}</Button> : !delivery.release ? <Button className="w-full" onClick={() => void action("release")} disabled={!master?.ready || busy !== null}><LockKeyhole className="size-4" /> {busy === "release" ? t("delivery.releasing") : t("delivery.release")}</Button> : master?.ready ? <Button className="w-full" onClick={() => void download(master, `${project.id}-final.mp4`)} disabled={busy !== null}><Download className="size-4" /> {t("delivery.downloadReleased")}</Button> : null}{delivery?.approval.status === "approved" && <p className="text-xs text-muted-foreground">{t("delivery.approvedAt", { date: formatDate(delivery.approval.approvedAt!, locale) })}</p>}{delivery?.release && <p className="text-xs text-success">{t("delivery.releasedAt", { date: formatDate(delivery.release.releasedAt, locale) })}</p>}</div></section>
      </div>

      <section>
        <h3 className="text-sm font-semibold">{t("delivery.sharing")}</h3>
        {!delivery?.release ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("delivery.sharingLocked")}</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card-soft p-4">
            <div className="flex items-center gap-3">
              <span className={cn("grid size-9 place-items-center rounded-lg", shared ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>{shared ? <Globe className="size-4" /> : <Lock className="size-4" />}</span>
              <div>
                <p className="text-sm font-medium">{t(shared ? "delivery.sharedState" : "delivery.privateState")}</p>
                {shared && <button onClick={() => void copyLink()} className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"><Copy className="size-3" /> {t(copied ? "delivery.linkCopied" : "delivery.copyLink")}</button>}
              </div>
            </div>
            <Button variant={shared ? "outline" : "default"} size="sm" onClick={() => void toggleShare()} disabled={busy !== null}>
              {shared ? <Lock className="size-4" /> : <Globe className="size-4" />} {busy === "share" ? t("delivery.updating") : t(shared ? "delivery.makePrivate" : "delivery.sharePublicly")}
            </Button>
          </div>
        )}
      </section>

      <section><h3 className="text-sm font-semibold">{t("delivery.deliverables")}</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{[preview, thumbnail, master, summaryArtifact].filter((item): item is ProjectArtifact => Boolean(item)).map((artifact) => <div key={artifact.id} className="rounded-lg border bg-background p-3"><div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{t(artifactLabelKey[artifact.id])}</span><Badge variant="outline">{artifact.ready ? sizeOf(artifact.size, t) : t(artifact.stale ? "common.stale" : "common.pending")}</Badge></div>{artifact.ready && artifact.id !== "delivery" && <Button className="mt-3" size="sm" variant="ghost" onClick={() => void download(artifact, filenameOf(project.id, artifact.id))} disabled={busy !== null}><Download className="size-3.5" /> {t("common.download")}</Button>}</div>)}</div></section>

      {delivery?.summary && <section><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">{t("delivery.auditedSummary")}</h3><p className="mt-1 text-xs text-muted-foreground">{t("delivery.auditedSummaryHint")}</p></div><Badge variant="secondary">{t("delivery.summaryTier", { tier: delivery.summary.tier || t("common.unknown") })}</Badge></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Summary label={t("delivery.summary.photoAnalysis")} value={delivery.summary.provenance?.photoContent || t("common.missing")} detail={delivery.summary.provenance?.note} /><Summary label={t("delivery.summary.qaVerdict")} value={delivery.summary.qa?.verdict || t("common.unknown")} detail={delivery.summary.qa?.reason} /><Summary label={t("delivery.summary.thumbnailChosenBy")} value={delivery.summary.thumbnail?.chosenBy || t("common.unknown")} detail={delivery.summary.thumbnail?.reason} /><Summary label={t("delivery.summary.film")} value={delivery.summary.video ? `${delivery.summary.video.width}×${delivery.summary.video.height} · ${formatDuration(delivery.summary.video.durationSec || 0)}` : t("common.unknown")} detail={delivery.summary.content ? t("delivery.summary.content", { scenes: delivery.summary.content.slides || 0, photos: delivery.summary.content.uniquePhotos || 0 }) : undefined} /></div></section>}
    </CardContent>
  </Card>
}

function CheckRow({ done, label }: { done: boolean; label: string }) { return <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><span className={cn("grid size-5 place-items-center rounded-full", done ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground")}>{done ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}</span>{label}</div> }

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="rounded-lg border bg-card-soft p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm font-medium">{value}</p>{detail && <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>}</div> }
function filenameOf(projectId: string, id: ProjectArtifact["id"]) { return id === "preview" ? `${projectId}-preview.mp4` : id === "thumbnail" ? `${projectId}-thumbnail.jpg` : id === "summary" ? `${projectId}-summary.json` : `${projectId}-${id}` }
function sizeOf(size: number | null, t: Translate) { if (size === null) return t("common.ready"); return size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB` }
function formatDuration(seconds: number) { const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}` }
function formatDate(value: string, locale: Locale) { return new Intl.DateTimeFormat(intlLocales[locale], { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) }
