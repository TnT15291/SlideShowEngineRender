import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Clock3, Film, Image as ImageIcon, RefreshCw, Replace } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPatch } from "@/lib/api"
import { useApiObjectUrl } from "@/lib/use-api-object-url"
import { cn } from "@/lib/utils"
import { RevisionPanel } from "@/RevisionPanel"
import type { ProjectAsset, ProjectSummary, TimelineImageSlot, TimelineScene, TimelineSnapshot } from "@/types"

export function TimelineViewer({ project, photos }: { project: ProjectSummary; photos: ProjectAsset[] }) {
  const [timeline, setTimeline] = useState<TimelineSnapshot | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refresh() {
    setLoading(true); setError(null)
    try {
      const value = await apiGet<TimelineSnapshot>(`/projects/${project.id}/timeline`)
      setTimeline(value)
      setSelectedId((current) => value.scenes.some((scene) => scene.id === current) ? current : value.scenes[0]?.id || null)
    } catch (reason) { setError(messageOf(reason)) } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [project.id])
  const selected = timeline?.scenes.find((scene) => scene.id === selectedId) || null

  async function replaceImage(slot: TimelineImageSlot) {
    if (!selected) return
    const assetId = choices[slot.id]
    if (!assetId) { setError("Choose a replacement photo first."); return }
    setSaving(slot.id); setError(null); setNotice(null)
    try {
      const next = await apiPatch<TimelineSnapshot>(`/projects/${project.id}/timeline`, { sceneId: selected.id, slotId: slot.id, assetId })
      setTimeline(next)
      setNotice("Image replaced. Render, QA, preview, and delivery are now stale; run the pipeline again.")
    } catch (reason) { setError(messageOf(reason)) } finally { setSaving(null) }
  }

  return <Card className="mt-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Film className="size-4 text-primary" /> Timeline Viewer</CardTitle><CardDescription className="mt-1">Inspect scene flow and replace one assigned photo without rebuilding the story.</CardDescription></div><div className="flex items-center gap-3">{timeline?.ready && <Badge variant="outline">{timeline.scenes.length} scenes · {formatTime(timeline.totalDuration)}</Badge>}<Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button></div></div></CardHeader>
    <CardContent className="p-6">
      {error && <p className="mb-4 flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      {notice && <p className="mb-4 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><Check className="mt-0.5 size-4 shrink-0" /> {notice}</p>}
      {!loading && timeline && !timeline.ready && <div className="grid min-h-52 place-items-center rounded-xl border border-dashed bg-card-soft text-center"><div><Film className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Timeline has not been generated</p><p className="mt-1 text-xs text-muted-foreground">Run Dry run or Template MVP, then refresh this panel.</p></div></div>}
      {timeline?.ready && <>
        <RevisionPanel project={project} onChanged={refresh} />
        <StoryFlow scenes={timeline.scenes} selectedId={selectedId} onSelect={setSelectedId} />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(280px,.7fr)_minmax(0,1.3fr)]">
          <div className="max-h-[680px] space-y-2 overflow-y-auto pr-1">{timeline.scenes.map((scene) => <SceneRow key={scene.id} scene={scene} active={scene.id === selectedId} onClick={() => setSelectedId(scene.id)} />)}</div>
          {selected && <SceneDetail scene={selected} renderUrl={timeline.renderUrl} photos={photos} choices={choices} saving={saving} onChoice={(slotId, assetId) => setChoices((current) => ({ ...current, [slotId]: assetId }))} onReplace={replaceImage} />}
        </div>
      </>}
    </CardContent>
  </Card>
}

function StoryFlow({ scenes, selectedId, onSelect }: { scenes: TimelineScene[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <section><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium">Story flow</span><span className="text-muted-foreground">Click a scene to inspect it</span></div><div className="flex h-12 gap-1 overflow-x-auto rounded-lg bg-muted p-1">{scenes.map((scene) => <button key={scene.id} onClick={() => onSelect(scene.id)} style={{ flexGrow: scene.duration }} className={cn("min-w-8 rounded-md px-2 text-[10px] font-medium transition-colors", scene.id === selectedId ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground")} title={`${scene.id} · ${scene.effect} · ${scene.duration.toFixed(1)}s`}>{scene.index + 1}</button>)}</div></section>
}

function SceneRow({ scene, active, onClick }: { scene: TimelineScene; active: boolean; onClick: () => void }) {
  const image = scene.images[0]
  return <button onClick={onClick} className={cn("grid w-full grid-cols-[80px_1fr] gap-3 rounded-lg border p-2 text-left transition-colors", active ? "border-primary bg-primary/5" : "bg-background hover:bg-card-soft")}>
    <ProtectedImage path={image?.url} className="h-full w-full object-cover" alt="" />
    <div className="min-w-0"><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{scene.index + 1}. {scene.id}</span><span className="shrink-0 text-xs text-muted-foreground">{scene.duration.toFixed(1)}s</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{scene.layout || scene.effect} · {scene.transition.type}</p></div>
  </button>
}

function SceneDetail({ scene, renderUrl, photos, choices, saving, onChoice, onReplace }: {
  scene: TimelineScene; renderUrl: string | null; photos: ProjectAsset[]; choices: Record<string, string>; saving: string | null
  onChoice: (slotId: string, assetId: string) => void; onReplace: (slot: TimelineImageSlot) => void
}) {
  return <div className="min-w-0 space-y-5"><ScenePreview scene={scene} renderUrl={renderUrl} /><div className="grid gap-3 sm:grid-cols-3"><Meta label="Effect" value={scene.effect} /><Meta label="Layout / renderer" value={scene.layout || scene.renderer} /><Meta label="Transition" value={`${scene.transition.type} · ${scene.transition.duration.toFixed(2)}s`} /></div>
    {scene.captions.length > 0 && <div className="rounded-lg border bg-card-soft p-4"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Caption</p>{scene.captions.map((caption, index) => <p key={index} className="mt-2 text-sm">{caption}</p>)}</div>}
    <section><div className="mb-3 flex items-center justify-between"><p className="text-sm font-medium">Assigned images</p><span className="text-xs text-muted-foreground">{scene.images.length} slot{scene.images.length === 1 ? "" : "s"}</span></div><div className="space-y-3">{scene.images.map((slot) => <div key={slot.id} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[96px_1fr]"><ProtectedImage path={slot.url} className="h-full w-full object-cover" alt={slot.label} /><div className="min-w-0"><p className="text-sm font-medium">{slot.label}</p><p className="mt-0.5 truncate text-xs text-muted-foreground" title={slot.path}>{slot.path}</p><div className="mt-3 flex gap-2"><select className="field h-8 min-w-0 flex-1 py-1 text-xs" value={choices[slot.id] || ""} onChange={(event) => onChoice(slot.id, event.target.value)}><option value="">Choose uploaded photo…</option>{photos.map((photo) => <option key={photo.id} value={photo.id}>#{photo.uploadIndex + 1} · {photo.originalName}</option>)}</select><Button size="sm" variant="outline" disabled={!choices[slot.id] || saving !== null} onClick={() => onReplace(slot)}><Replace className="size-3.5" /> {saving === slot.id ? "Saving…" : "Replace"}</Button></div></div></div>)}{scene.images.length === 0 && <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">This scene has no replaceable image slot.</p>}</div></section>
  </div>
}

function ScenePreview({ scene, renderUrl }: { scene: TimelineScene; renderUrl: string | null }) {
  const video = useRef<HTMLVideoElement>(null)
  const previewStart = Math.max(scene.start, scene.end - 2.5)
  useEffect(() => { if (video.current && video.current.readyState >= 1) video.current.currentTime = previewStart }, [previewStart, scene.id])
  const poster = useApiObjectUrl(scene.images[0]?.url)
  const videoUrl = useApiObjectUrl(renderUrl)
  return <div><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Scene {scene.index + 1} preview</p><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" /> {formatTime(scene.start)}–{formatTime(scene.end)}</span></div><div className="aspect-video overflow-hidden rounded-xl border bg-black">{videoUrl ? <video key={`${videoUrl}-${scene.id}`} ref={video} className="h-full w-full" controls preload="metadata" poster={poster || undefined} onLoadedMetadata={(event) => { event.currentTarget.currentTime = previewStart }} onTimeUpdate={(event) => { if (event.currentTarget.currentTime >= scene.end) event.currentTarget.pause() }}><source src={videoUrl} type="video/mp4" /></video> : poster ? <img className="h-full w-full object-contain" src={poster} alt={`Scene ${scene.index + 1}`} /> : <div className="grid h-full place-items-center text-sm text-white/50">{renderUrl ? "Loading preview…" : "No fresh render or image preview"}</div>}</div>{renderUrl && <p className="mt-2 text-xs text-muted-foreground">Starts 2.5 seconds before the scene ends so reveal effects can be checked at their final frame.</p>}</div>
}

function ProtectedImage({ path, className, alt }: { path: string | null | undefined; className: string; alt: string }) {
  const url = useApiObjectUrl(path)
  return <div className="aspect-video overflow-hidden rounded-md bg-muted">{url ? <img className={className} src={url} alt={alt} /> : <div className="grid h-full place-items-center"><ImageIcon className="size-4 text-muted-foreground" /></div>}</div>
}

function Meta({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-background p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm" title={value}>{value}</p></div> }
function formatTime(seconds: number) { const rounded = Math.round(seconds); return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}` }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
