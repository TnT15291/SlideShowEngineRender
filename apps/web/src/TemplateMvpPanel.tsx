import { useEffect, useMemo, useState } from "react"
import { Check, Circle, Download, Film, Image as ImageIcon, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, downloadApiFile } from "@/lib/api"
import { useApiObjectUrl } from "@/lib/use-api-object-url"
import type { JobSnapshot, ProjectArtifact, ProjectSummary } from "@/types"

const milestoneIds = ["timeline", "render", "qa-report", "preview", "delivery"] as const

export function TemplateMvpPanel({ project, job }: { project: ProjectSummary; job: JobSnapshot | null }) {
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
      setError(reason instanceof Error ? reason.message : String(reason))
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
  const previewUrl = useApiObjectUrl(reviewVideo?.url)
  const thumbnailUrl = useApiObjectUrl(thumbnail?.ready ? thumbnail.url : null)

  async function download(id: string, url: string, filename: string) {
    setDownloading(id); setError(null)
    try { await downloadApiFile(url, filename) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setDownloading(null) }
  }

  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Film className="size-4 text-primary" /> Render review</CardTitle><CardDescription className="mt-1">Watch the latest rendered film and check its production artifacts.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}><RefreshCw className={refreshing ? "size-4 animate-spin" : "size-4"} /> Refresh</Button></div></CardHeader>
    <CardContent className="grid gap-6 p-6 lg:grid-cols-[.8fr_1.2fr]">
      <section><p className="text-sm font-medium">MVP checkpoint</p><div className="mt-3 space-y-2">{milestoneIds.map((id) => { const artifact = byId.get(id); const Icon = artifact?.ready ? Check : Circle; return <div key={id} className="flex items-center justify-between rounded-lg border bg-background px-3 py-2"><span className="flex items-center gap-2 text-sm"><Icon className={artifact?.ready ? "size-4 text-success" : "size-4 text-muted-foreground"} /> {artifact?.label || labels[id]}</span><span className="text-xs text-muted-foreground">{artifact?.ready ? sizeOf(artifact.size) : artifact?.stale ? "Stale" : "Pending"}</span></div> })}</div>
        {project.recipe && <p className="mt-4 text-xs text-muted-foreground">Recipe: <span className="font-medium text-foreground">{project.recipe}</span></p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        <div className="mt-5 flex flex-wrap gap-2">{delivery?.ready && <Button size="sm" disabled={downloading !== null} onClick={() => void download(delivery.id, delivery.url, `${project.id}-film.mp4`)}><Download className="size-4" /> {downloading === delivery.id ? "Downloading…" : "Download film"}</Button>}{summary?.ready && <Button size="sm" variant="outline" disabled={downloading !== null} onClick={() => void download(summary.id, summary.url, `${project.id}-summary.json`)}><Download className="size-4" /> {downloading === summary.id ? "Downloading…" : "Summary"}</Button>}</div>
      </section>
      <section className="min-w-0"><div className="aspect-video overflow-hidden rounded-xl border bg-black">{previewUrl ? <video key={`${reviewVideo?.updatedAt}-${previewUrl}`} className="h-full w-full" controls preload="metadata" poster={thumbnailUrl || undefined}><source src={previewUrl} type="video/mp4" /></video> : <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/60"><ImageIcon className="size-7" /><span>{reviewVideo ? "Loading rendered film…" : "The review player appears after a render completes."}</span></div>}</div>{reviewVideo && <p className="mt-2 text-xs text-muted-foreground">Showing {reviewVideo.id === "preview" ? "the delivery preview" : "the latest rendered film"}.</p>}</section>
    </CardContent>
  </Card>
}

const labels: Record<(typeof milestoneIds)[number], string> = { timeline: "Timeline", render: "Rendered film", "qa-report": "Rule-based QA", preview: "Preview", delivery: "Delivery master" }
function sizeOf(size: number | null) { if (size === null) return "Ready"; if (size < 1024) return `${size} B`; if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`; return `${(size / 1024 ** 2).toFixed(1)} MB` }
