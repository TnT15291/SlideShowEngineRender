import { useEffect, useMemo, useState } from "react"
import { Check, Circle, Download, Film, Image as ImageIcon, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, downloadApiFile } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n } from "@/lib/i18n"
import { artifactLabelKey } from "@/projectFormat"
import { useApiObjectUrl } from "@/lib/use-api-object-url"
import type { JobSnapshot, ProjectArtifact, ProjectSummary } from "@/types"

const milestoneIds = ["timeline", "render", "qa-report", "preview", "delivery"] as const

export function TemplateMvpPanel({ project, job, styleName }: { project: ProjectSummary; job: JobSnapshot | null; styleName?: string | null }) {
  const { t } = useI18n()
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)

  async function refresh() {
    setRefreshing(true)
    try {
      setArtifacts(await apiGet<ProjectArtifact[]>(`/projects/${project.id}/artifacts`))
      setError(null)
    } catch (reason) {
      setError(apiMessage(reason, t))
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { void refresh() }, [project.id, job?.updatedAt])
  useEffect(() => {
    if (job?.status !== "running" && job?.status !== "pending") return
    const timer = window.setInterval(() => { void refresh() }, 2_000)
    return () => window.clearInterval(timer)
  }, [project.id, job?.status])

  const byId = useMemo(() => new Map(artifacts.map((artifact) => [artifact.id, artifact])), [artifacts])
  const preview = byId.get("preview")
  const render = byId.get("render")
  const thumbnail = byId.get("thumbnail")
  const delivery = byId.get("delivery")
  const summary = byId.get("summary")
  const reviewVideo = preview?.ready ? preview : render?.ready ? render : null
  const downloadableFilm = delivery?.ready ? delivery : render?.ready ? render : null
  const previewUrl = useApiObjectUrl(reviewVideo?.url)
  const thumbnailUrl = useApiObjectUrl(thumbnail?.ready ? thumbnail.url : null)

  async function download(id: string, url: string, filename: string) {
    setDownloading(id); setError(null)
    try { await downloadApiFile(url, filename) }
    catch (reason) { setError(apiMessage(reason, t)) }
    finally { setDownloading(null) }
  }

  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Film className="size-4 text-primary" /> {t("render.title")}</CardTitle><CardDescription className="mt-1">{t("render.description")}</CardDescription></div><Button variant="ghost" size="icon" aria-label={t("render.refreshLabel")} onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /></Button></div></CardHeader>
    <CardContent className="grid gap-6 p-6 lg:grid-cols-[.8fr_1.2fr]">
      {/* The server's own `artifact.label` is English-only, so the milestone
          name is looked up by artifact id instead of trusting what it sent. */}
      <section><p className="text-sm font-medium">{t("render.productionFiles")}</p><div className="mt-3 space-y-2">{milestoneIds.map((id) => { const artifact = byId.get(id); const Icon = artifact?.ready ? Check : Circle; return <div key={id} className="flex items-center justify-between rounded-lg border bg-background px-3 py-2"><span className="flex items-center gap-2 text-sm"><Icon className={artifact?.ready ? "size-4 text-success" : "size-4 text-muted-foreground"} /> {t(artifactLabelKey[id])}</span><span className="text-xs text-muted-foreground" title={artifact?.ready ? undefined : artifact?.stale ? t("render.staleHint") : t("render.notProducedYet")}>{artifact?.ready ? sizeOf(artifact.size, t) : artifact?.stale ? t("render.needsReRender") : t("common.pending")}</span></div> })}</div>
        {styleName && <p className="mt-4 text-xs text-muted-foreground">{t("render.style")} <span className="font-medium text-foreground">{styleName}</span></p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">{downloadableFilm && <Button size="sm" disabled={downloading !== null} onClick={() => void download(downloadableFilm.id, downloadableFilm.url, `${project.id}-film.mp4`)}><Download className="size-4" /> {downloading === downloadableFilm.id ? t("common.downloading") : t("render.downloadFilm")}</Button>}{summary?.ready && <Button size="sm" variant="outline" disabled={downloading !== null} onClick={() => void download(summary.id, summary.url, `${project.id}-summary.json`)}><Download className="size-4" /> {downloading === summary.id ? t("common.downloading") : t("render.summary")}</Button>}</div>
      </section>
      <section className="min-w-0"><div className="aspect-video overflow-hidden rounded-xl border bg-black">{previewUrl ? <video key={`${reviewVideo?.updatedAt}-${previewUrl}`} className="h-full w-full" controls preload="metadata" poster={thumbnailUrl || undefined}><source src={previewUrl} type="video/mp4" /></video> : <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/60"><ImageIcon className="size-7" /><span>{reviewVideo ? t("render.loadingFilm") : t("render.playerAfterRender")}</span></div>}</div>{reviewVideo && <p className="mt-2 text-xs text-muted-foreground">{t(reviewVideo.id === "preview" ? "render.showingPreview" : "render.showingLatest")}</p>}</section>
    </CardContent>
  </Card>
}

function sizeOf(size: number | null, t: ReturnType<typeof useI18n>["t"]) { if (size === null) return t("common.ready"); if (size < 1024) return `${size} B`; if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1024 ** 2).toFixed(1)} MB` }
