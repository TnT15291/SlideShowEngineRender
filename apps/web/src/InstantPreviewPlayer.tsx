import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Pause, Play, RefreshCw, RotateCcw, Sparkles, Volume2, VolumeX } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet } from "@/lib/api"
import { useApiObjectUrl } from "@/lib/use-api-object-url"
import { cn } from "@/lib/utils"
import type { ProjectAsset, ProjectSummary, TimelineImageSlot, TimelineScene, TimelineSnapshot } from "@/types"

export function InstantPreviewPlayer({ project, music, refreshKey }: { project: ProjectSummary; music: ProjectAsset[]; refreshKey?: string | null }) {
  const [timeline, setTimeline] = useState<TimelineSnapshot | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const startedAt = useRef(0)
  const startedFrom = useRef(0)
  const audio = useRef<HTMLAudioElement>(null)
  const soundtrackUrl = useApiObjectUrl(music[0] ? `/projects/${project.id}/assets/${music[0].id}/content` : null)

  async function refresh() {
    setLoading(true); setError(null); setPlaying(false)
    try {
      const value = await apiGet<TimelineSnapshot>(`/projects/${project.id}/timeline`)
      setTimeline(value)
      setTime((current) => Math.min(current, value.totalDuration))
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [project.id, refreshKey])
  useEffect(() => {
    if (!playing || !timeline?.ready) return
    startedAt.current = performance.now()
    startedFrom.current = time
    let frame = 0
    const tick = (now: number) => {
      const next = Math.min(timeline.totalDuration, startedFrom.current + (now - startedAt.current) / 1000)
      setTime(next)
      if (next >= timeline.totalDuration) { setPlaying(false); return }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, timeline?.totalDuration])
  useEffect(() => {
    if (!audio.current) return
    audio.current.muted = muted
    if (!playing) audio.current.pause()
  }, [muted, playing])

  const scene = useMemo(() => timeline?.scenes.find((item) => time >= item.start && time < item.end) || timeline?.scenes.at(-1) || null, [timeline, time])
  const localProgress = scene ? Math.max(0, Math.min(1, (time - scene.start) / scene.duration)) : 0
  const nextScene = scene && timeline ? timeline.scenes[scene.index + 1] || null : null
  const transitionProgress = scene?.transition.duration
    ? Math.max(0, Math.min(1, (time - (scene.end - scene.transition.duration)) / scene.transition.duration))
    : 0

  function toggle() {
    if (!timeline?.ready) return
    const restart = time >= timeline.totalDuration
    const nextTime = restart ? 0 : time
    if (restart) setTime(0)
    if (playing) audio.current?.pause()
    else if (audio.current) {
      audio.current.currentTime = Math.min(nextTime, Math.max(0, audio.current.duration || nextTime))
      void audio.current.play().catch(() => undefined)
    }
    setPlaying(!playing)
  }

  return <Card className="mb-6 overflow-hidden">
    <CardHeader className="border-b bg-card-soft"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" /> Instant Preview</CardTitle><CardDescription className="mt-1">Review the timeline immediately without rendering a video file.</CardDescription></div><div className="flex items-center gap-2"><Badge variant="outline">No render required</Badge><Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button></div></div></CardHeader>
    <CardContent className="p-6">
      {error && <p className="mb-4 flex gap-2 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</p>}
      {!loading && (!timeline?.ready || !scene) ? <div className="grid aspect-video place-items-center rounded-xl border border-dashed bg-card-soft text-center"><div><Sparkles className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Generate the timeline first</p><p className="mt-1 text-xs text-muted-foreground">Run Dry run, then refresh Instant Preview.</p></div></div> : scene && timeline ? <>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black text-white">
          <SceneCanvas scene={scene} nextScene={nextScene} progress={localProgress} transitionProgress={transitionProgress} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-6 pb-6 pt-20 text-center">
            {scene.captions.map((caption, index) => <p key={index} className="mx-auto max-w-3xl font-serif text-xl font-medium drop-shadow-md md:text-3xl">{caption}</p>)}
          </div>
          <div className="absolute left-4 top-4 flex gap-2"><Badge className="border-white/20 bg-black/45 text-white backdrop-blur">Scene {scene.index + 1}/{timeline.scenes.length}</Badge>{scene.renderer !== "ffmpeg" && <Badge className="border-white/20 bg-amber-500/90 text-white">Approximate {scene.renderer} preview</Badge>}</div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button size="icon" onClick={toggle} aria-label={playing ? "Pause instant preview" : "Play instant preview"}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
          <Button size="icon" variant="outline" onClick={() => { setPlaying(false); setTime(0); if (audio.current) { audio.current.pause(); audio.current.currentTime = 0 } }} aria-label="Restart instant preview"><RotateCcw className="size-4" /></Button>
          {soundtrackUrl && <Button size="icon" variant="outline" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute soundtrack" : "Mute soundtrack"}>{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</Button>}
          <span className="w-11 text-right text-xs tabular-nums text-muted-foreground">{formatTime(time)}</span>
          <input className="h-2 min-w-0 flex-1 cursor-pointer accent-primary" type="range" min={0} max={timeline.totalDuration} step={0.05} value={time} aria-label="Instant preview position" onChange={(event) => { const next = Number(event.target.value); setPlaying(false); setTime(next); if (audio.current) { audio.current.pause(); audio.current.currentTime = Math.min(next, Math.max(0, audio.current.duration || next)) } }} />
          <span className="w-11 text-xs tabular-nums text-muted-foreground">{formatTime(timeline.totalDuration)}</span>
        </div>
        {soundtrackUrl && <audio ref={audio} src={soundtrackUrl} preload="auto" onEnded={() => setPlaying(false)} />}
        {music[0] && <p className="mt-2 text-xs text-muted-foreground">Soundtrack: {music[0].originalName}</p>}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">This browser preview approximates motion and transitions for fast editorial review. Use a rendered preview for final color, complex GPU/Blender effects, and output QA.</p>
      </> : <div className="grid aspect-video place-items-center rounded-xl bg-black text-sm text-white/60">Loading timeline…</div>}
    </CardContent>
  </Card>
}

function SceneCanvas({ scene, nextScene, progress, transitionProgress }: { scene: TimelineScene; nextScene: TimelineScene | null; progress: number; transitionProgress: number }) {
  return <div className="relative h-full w-full"><SceneLayer scene={scene} progress={progress} /><div className="absolute inset-0" style={{ opacity: transitionProgress }} aria-hidden={transitionProgress === 0}>{nextScene && <SceneLayer scene={nextScene} progress={0} />}</div></div>
}

function SceneLayer({ scene, progress }: { scene: TimelineScene; progress: number }) {
  const images = scene.images.slice(0, 4)
  const columns = images.length <= 1 ? "grid-cols-1" : "grid-cols-2"
  return <div className={cn("grid h-full w-full", columns)}>{images.length ? images.map((image) => <PreviewImage key={image.id} image={image} effect={scene.effect} progress={progress} />) : <div className="grid place-items-center text-sm text-white/50">Text-only scene</div>}</div>
}

function PreviewImage({ image, effect, progress }: { image: TimelineImageSlot; effect: string; progress: number }) {
  const url = useApiObjectUrl(image.url)
  const scale = effect === "still" ? 1 : effect.includes("zoom_out") ? 1.08 - progress * 0.08 : 1 + progress * 0.08
  const translateX = effect.includes("pan_left") ? 2 - progress * 4 : effect.includes("pan_right") ? -2 + progress * 4 : 0
  return <div className="min-h-0 min-w-0 overflow-hidden bg-neutral-950">{url ? <img src={url} alt={image.label} className="h-full w-full object-cover will-change-transform" style={{ transform: `scale(${scale}) translateX(${translateX}%)`, transition: "transform 80ms linear" }} /> : <div className="grid h-full place-items-center text-sm text-white/40">Image unavailable</div>}</div>
}

function formatTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds))
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`
}
