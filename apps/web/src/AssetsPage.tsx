import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import { AlertCircle, ArrowLeft, ArrowRight, Check, Circle, Clapperboard, Film, Image, Music2, PackageCheck, RefreshCw, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiDelete, apiGet, apiUpload } from "@/lib/api"
import { JobRunnerPanel } from "@/JobRunnerPanel"
import { InstantPreviewPlayer } from "@/InstantPreviewPlayer"
import { AnalysisPanel } from "@/AnalysisPanel"
import { TimelineViewer } from "@/TimelineViewer"
import { DirectorPanel } from "@/DirectorPanel"
import { AdvancedQaPanel } from "@/AdvancedQaPanel"
import { DeliveryPanel } from "@/DeliveryPanel"
import { cn } from "@/lib/utils"
import type { AssetKind, ProjectAsset, ProjectAssets, ProjectSummary } from "@/types"

type UploadStatus = "queued" | "uploading" | "error"
type UploadItem = { id: string; file: File; kind: AssetKind; uploadIndex: number; status: UploadStatus; progress: number; error: string | null }
type WorkspaceStep = "setup" | "media" | "direct" | "review" | "deliver"

const workflow = [
  { id: "setup", label: "Setup", icon: Clapperboard },
  { id: "media", label: "Media", icon: Image },
  { id: "direct", label: "Direct & Edit", icon: Sparkles },
  { id: "review", label: "Render & Review", icon: Film },
  { id: "deliver", label: "Deliver", icon: PackageCheck },
] as const

function initialWorkspaceStep(): WorkspaceStep {
  const value = new URLSearchParams(window.location.search).get("step")
  return workflow.some((step) => step.id === value) ? value as WorkspaceStep : "setup"
}

const accepted = {
  photo: { input: ".jpg,.jpeg,.png,.webp,.heic,.heif", mime: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) },
  music: { input: ".mp3,.wav,.m4a,.aac,.flac,.ogg", mime: new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac", "audio/x-flac", "audio/ogg"]) },
} as const

export function AssetsPage({ project, onBack, onRenderStarted }: { project: ProjectSummary; onBack: () => void; onRenderStarted?: () => void }) {
  const [step, setStep] = useState<WorkspaceStep>(initialWorkspaceStep)
  const [currentProject, setCurrentProject] = useState(project)
  const [assets, setAssets] = useState<ProjectAssets | null>(null)
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const queueRef = useRef(queue)
  queueRef.current = queue

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      apiGet<ProjectAssets>(`/projects/${project.id}/assets`),
      apiGet<ProjectSummary>(`/projects/${project.id}`),
    ]).then(([nextAssets, nextProject]) => { setAssets(nextAssets); setCurrentProject(nextProject) }).catch((reason: unknown) => setError(messageOf(reason))).finally(() => setLoading(false))
  }, [project.id])

  useEffect(reload, [reload])

  function addFiles(kind: AssetKind, files: File[]) {
    if (!files.length) return
    const existing = kind === "photo" ? assets?.photos || [] : assets?.music || []
    const pending = queueRef.current.filter((item) => item.kind === kind)
    let nextIndex = Math.max(-1, ...existing.map((item) => item.uploadIndex), ...pending.map((item) => item.uploadIndex)) + 1
    const maxBytes = kind === "photo" ? assets?.limits.photoMaxBytes : assets?.limits.musicMaxBytes
    const additions = files.map((file): UploadItem => {
      const typeAllowed = accepted[kind].mime.has(file.type as never)
      const validationError = !typeAllowed ? `Unsupported ${kind} file type` : maxBytes && file.size > maxBytes ? `File exceeds ${formatBytes(maxBytes)}` : file.size === 0 ? "File is empty" : null
      return { id: crypto.randomUUID(), file, kind, uploadIndex: nextIndex++, status: validationError ? "error" : "queued", progress: 0, error: validationError }
    })
    setQueue((current) => [...current, ...additions])
  }

  async function uploadOne(item: UploadItem) {
    setQueue((current) => current.map((queued) => queued.id === item.id ? { ...queued, status: "uploading", progress: 0, error: null } : queued))
    const query = new URLSearchParams({ kind: item.kind, filename: item.file.name, uploadIndex: String(item.uploadIndex) })
    try {
      const uploaded = await apiUpload<ProjectAsset>(`/projects/${project.id}/assets?${query}`, item.file, (progress) => {
        setQueue((current) => current.map((queued) => queued.id === item.id ? { ...queued, progress } : queued))
      })
      setAssets((current) => current ? {
        ...current,
        photos: item.kind === "photo" ? [...current.photos, uploaded].sort(byUploadIndex) : current.photos,
        music: item.kind === "music" ? [...current.music, uploaded].sort(byUploadIndex) : current.music,
      } : current)
      setQueue((current) => current.filter((queued) => queued.id !== item.id))
    } catch (reason) {
      setQueue((current) => current.map((queued) => queued.id === item.id ? { ...queued, status: "error", error: messageOf(reason) } : queued))
    }
  }

  useEffect(() => {
    const ready = queue.filter((item) => item.status === "queued")
    if (ready.length) void Promise.all(ready.map(uploadOne))
  }, [queue])

  async function removeAsset(asset: ProjectAsset) {
    setDeleting((current) => new Set(current).add(asset.id))
    setError(null)
    try {
      setAssets(await apiDelete<ProjectAssets>(`/projects/${project.id}/assets/${asset.id}`))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setDeleting((current) => { const next = new Set(current); next.delete(asset.id); return next })
    }
  }

  const uploading = queue.some((item) => item.status === "uploading")

  const hasPhotos = Boolean(assets?.photos.length)
  const hasMusic = Boolean(assets?.music.length)
  const mediaReady = hasPhotos && hasMusic
  const renderReady = currentProject.phases.render === "completed" || currentProject.phases.render === "skipped"
  const reviewReady = renderReady && (currentProject.phases.qa === "completed" || currentProject.phases.qa === "skipped")
  const deliveryReady = currentProject.phases.deliver === "completed"
  const completed: Record<WorkspaceStep, boolean> = { setup: true, media: mediaReady, direct: currentProject.tier === "template" || currentProject.phases.plan === "completed" || currentProject.phases.build === "completed", review: reviewReady, deliver: deliveryReady }

  function goToStep(next: WorkspaceStep) {
    setStep(next)
    const url = new URL(window.location.href)
    url.searchParams.set("step", next)
    window.history.replaceState({}, "", url)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return <main className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-20 flex h-20 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur md:px-10"><Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Project workspace</p><h1 className="truncate font-serif text-xl font-semibold">{currentProject.name}</h1></div><Badge variant="secondary" className="hidden border-0 capitalize sm:inline-flex">{currentProject.tier}</Badge><Button variant="outline" size="sm" className="ml-auto" onClick={reload} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button></header>

    <div className="border-b bg-card-soft"><nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-3 md:px-10" aria-label="Film workflow">{workflow.map(({ id, label, icon: Icon }, index) => <button key={id} onClick={() => goToStep(id)} className={cn("flex min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors", step === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground")}><span className={cn("grid size-5 place-items-center rounded-full", step === id ? "bg-white/15" : completed[id] ? "bg-success/15 text-success" : "bg-muted")}>{completed[id] ? <Check className="size-3" /> : <Icon className="size-3" />}</span><span>{index + 1}. {label}</span></button>)}</nav></div>

    <div className="mx-auto max-w-6xl px-6 py-9 md:px-10">
      {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="flex gap-2 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</CardContent></Card>}

      {step === "setup" && <WorkspaceSection eyebrow="Step 1 of 5" title="Project setup" description="Review the creative contract before adding media.">
        <Card><CardContent className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3"><ProjectFact label="Project" value={currentProject.name} /><ProjectFact label="Tier" value={currentProject.tier} /><ProjectFact label="Recipe" value={currentProject.recipe || "AI Director"} /><ProjectFact label="Language" value={currentProject.language || "Not set"} /><ProjectFact label="Photo order" value={currentProject.sequenceMode || "Not set"} /><ProjectFact label="Output quality" value={currentProject.quality} /></CardContent></Card>
        <NextAction title="Setup is ready" detail="Add the source photos and soundtrack for this film." action="Continue to Media" onClick={() => goToStep("media")} />
      </WorkspaceSection>}

      {step === "media" && <WorkspaceSection eyebrow="Step 2 of 5" title="Add photos and music" description="Files upload automatically after selection. Upload order is preserved for chronological edits." action={uploading ? <Badge variant="secondary" className="border-0"><RefreshCw className="mr-1 size-3 animate-spin" /> Uploading…</Badge> : undefined}>
        <Card className="mb-6"><CardContent className="grid gap-3 p-4 sm:grid-cols-2"><Requirement done={hasPhotos} label={hasPhotos ? `${assets?.photos.length} photos added` : "Add at least one photo"} /><Requirement done={hasMusic} label={hasMusic ? `${assets?.music.length} soundtrack${assets?.music.length === 1 ? "" : "s"} added` : "Add a soundtrack"} /></CardContent></Card>
        <div className="grid gap-6 lg:grid-cols-2"><AssetSection kind="photo" title="Wedding photos" description="JPEG, PNG, WebP or HEIC · up to 50 MB each" icon={Image} assets={assets?.photos || []} queue={queue.filter((item) => item.kind === "photo")} deleting={deleting} onFiles={(files) => addFiles("photo", files)} onRetry={uploadOne} onRemoveQueue={(id) => setQueue((current) => current.filter((item) => item.id !== id))} onDelete={removeAsset} /><AssetSection kind="music" title="Soundtrack" description="MP3, WAV, M4A, AAC, FLAC or OGG · up to 200 MB each" icon={Music2} assets={assets?.music || []} queue={queue.filter((item) => item.kind === "music")} deleting={deleting} onFiles={(files) => addFiles("music", files)} onRetry={uploadOne} onRemoveQueue={(id) => setQueue((current) => current.filter((item) => item.id !== id))} onDelete={removeAsset} /></div>
        <AnalysisPanel project={currentProject} />
        <NextAction title={mediaReady ? "Media is ready" : "Complete the media checklist"} detail={mediaReady ? "Continue to direct the story and inspect the edit." : "A film needs photos and at least one soundtrack before the pipeline can run."} action="Continue to Direct & Edit" disabled={!mediaReady} onClick={() => goToStep("direct")} />
      </WorkspaceSection>}

      {step === "direct" && <WorkspaceSection eyebrow="Step 3 of 5" title="Direct and edit" description={currentProject.tier === "template" ? "This project follows its selected recipe. Generate a timeline in the next step, then return here to inspect it." : "Shape the story with AI Director, then inspect scenes and request focused revisions."}>
        {currentProject.tier === "template" ? <Card><CardContent className="flex gap-4 p-6"><span className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Clapperboard className="size-5" /></span><div><p className="font-medium">Recipe direction is locked</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{currentProject.recipe || "Selected recipe"} controls the visual grammar. AI Director is intentionally hidden for Template projects.</p></div></CardContent></Card> : <DirectorPanel project={currentProject} />}
        <TimelineViewer project={currentProject} photos={assets?.photos || []} />
        <NextAction title="Ready for a pipeline run" detail="A dry run creates or refreshes the timeline without rendering video." action="Continue to Render & Review" disabled={!mediaReady} onClick={() => goToStep("review")} />
      </WorkspaceSection>}

      {step === "review" && <WorkspaceSection eyebrow="Step 4 of 5" title="Render and review" description="Run the pipeline, follow progress, then inspect quality findings.">
        <InstantPreviewPlayer project={currentProject} music={assets?.music || []} refreshKey={currentProject.updatedAt} />
        {!mediaReady ? <BlockedNotice message="Add photos and a soundtrack in Media before running the pipeline." onClick={() => goToStep("media")} /> : <JobRunnerPanel project={currentProject} onRenderStarted={onRenderStarted} onJobChanged={(job) => setCurrentProject((value) => ({ ...value, status: job.status === "pending" ? "running" : job.status, currentPhase: job.currentPhase, progress: job.progress, error: job.error, phases: job.phases, updatedAt: job.updatedAt }))} />}
        <details className="mt-6 rounded-xl border bg-card"><summary className="cursor-pointer list-none px-6 py-5 text-sm font-medium">Advanced QA details <span className="ml-2 text-xs font-normal text-muted-foreground">Rules, repairs, and manual review</span></summary><div className="border-t px-6 pb-6"><AdvancedQaPanel project={currentProject} /></div></details>
        <NextAction title={reviewReady ? "Review is complete" : renderReady ? "Render is ready; check QA" : "Render a preview first"} detail="Delivery becomes available after the film and QA artifacts are generated." action="Continue to Deliver" disabled={!renderReady} onClick={() => goToStep("deliver")} />
      </WorkspaceSection>}

      {step === "deliver" && <WorkspaceSection eyebrow="Step 5 of 5" title="Approve and deliver" description="Review the current preview, approve its exact version, then release the final files.">
        {!renderReady && <BlockedNotice message="Render a fresh preview before approval and delivery." onClick={() => goToStep("review")} />}
        <DeliveryPanel project={currentProject} />
      </WorkspaceSection>}
    </div>
  </main>
}

function WorkspaceSection({ eyebrow, title, description, action, children }: { eyebrow: string; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><Badge variant="secondary" className="mb-3 border-0">{eyebrow}</Badge><h2 className="font-serif text-3xl font-semibold">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action}</div>{children}</section>
}

function ProjectFact({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1.5 text-sm font-medium capitalize">{value}</p></div> }
function Requirement({ done, label }: { done: boolean; label: string }) { const Icon = done ? Check : Circle; return <div className={cn("flex items-center gap-3 rounded-lg border px-4 py-3 text-sm", done && "border-success/30 bg-success/5")}><Icon className={cn("size-4", done ? "text-success" : "text-muted-foreground")} /> {label}</div> }
function NextAction({ title, detail, action, disabled = false, onClick }: { title: string; detail: string; action: string; disabled?: boolean; onClick: () => void }) { return <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sidebar p-5 text-white"><div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs leading-5 text-sidebar-muted">{detail}</p></div><Button size="lg" disabled={disabled} onClick={onClick}>{action} <ArrowRight className="size-4" /></Button></div> }
function BlockedNotice({ message, onClick }: { message: string; onClick: () => void }) { return <Card className="mb-6 border-amber-300 bg-amber-50"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-amber-950"><span className="flex items-center gap-2"><AlertCircle className="size-4" /> {message}</span><Button variant="outline" size="sm" onClick={onClick}>Fix prerequisite</Button></CardContent></Card> }

function AssetSection({ kind, title, description, icon: Icon, assets, queue, deleting, onFiles, onRetry, onRemoveQueue, onDelete }: {
  kind: AssetKind; title: string; description: string; icon: typeof Image; assets: ProjectAsset[]; queue: UploadItem[]; deleting: Set<string>
  onFiles: (files: File[]) => void; onRetry: (item: UploadItem) => void; onRemoveQueue: (id: string) => void; onDelete: (asset: ProjectAsset) => void
}) {
  const [dragging, setDragging] = useState(false)
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    onFiles(Array.from(event.dataTransfer.files))
  }
  return <Card className="overflow-hidden"><CardHeader><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-5" /></div><div><CardTitle className="text-base">{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div><Badge variant="outline" className="ml-auto font-normal">{assets.length}</Badge></div></CardHeader><CardContent className="space-y-4">
    <div onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={drop} className={cn("grid min-h-36 place-items-center rounded-xl border border-dashed p-6 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "bg-card-soft")}><div><Upload className="mx-auto size-7 text-primary" /><p className="mt-3 text-sm font-medium">Drop {kind === "photo" ? "photos" : "music"} here</p><p className="mt-1 text-xs text-muted-foreground">Files upload automatically after selection</p><label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}><input type="file" multiple className="sr-only" accept={accepted[kind].input} onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = "" }} />Choose files</label></div></div>
    {(queue.length > 0 || assets.length > 0) && <div className="divide-y rounded-lg border">{queue.map((item) => <QueueRow key={item.id} item={item} onRetry={() => onRetry(item)} onRemove={() => onRemoveQueue(item.id)} />)}{assets.map((asset) => <div key={asset.id} className="flex items-center gap-3 p-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-success/10 text-success"><Check className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{asset.originalName}</p><p className="mt-0.5 text-xs text-muted-foreground">#{asset.uploadIndex + 1} · {formatBytes(asset.size)}</p></div><Button variant="ghost" size="icon" aria-label={`Delete ${asset.originalName}`} disabled={deleting.has(asset.id)} onClick={() => onDelete(asset)}><Trash2 className="size-4" /></Button></div>)}</div>}
  </CardContent></Card>
}

function QueueRow({ item, onRetry, onRemove }: { item: UploadItem; onRetry: () => void; onRemove: () => void }) {
  return <div className="p-3"><div className="flex items-center gap-3"><span className={cn("grid size-8 shrink-0 place-items-center rounded-md", item.status === "error" ? "bg-destructive/10 text-destructive" : "bg-secondary text-primary")}>{item.status === "error" ? <AlertCircle className="size-4" /> : <Upload className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.file.name}</p><p className={cn("mt-0.5 truncate text-xs", item.error ? "text-destructive" : "text-muted-foreground")}>{item.error || `${formatBytes(item.file.size)} · ${item.status}`}</p></div>{item.status === "error" && <Button variant="ghost" size="icon" onClick={onRetry} aria-label={`Retry ${item.file.name}`}><RotateCcw className="size-4" /></Button>}{item.status !== "uploading" && <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${item.file.name}`}><X className="size-4" /></Button>}</div>{item.status === "uploading" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${item.progress}%` }} /></div>}</div>
}

function byUploadIndex(left: ProjectAsset, right: ProjectAsset) { return left.uploadIndex - right.uploadIndex }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB` }
