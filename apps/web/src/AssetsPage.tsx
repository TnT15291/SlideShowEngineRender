import { useCallback, useEffect, useRef, useState, type DragEvent } from "react"
import { AlertCircle, ArrowRight, Check, Circle, Clapperboard, CreditCard, Film, Image, Menu, Music2, PackageCheck, RefreshCw, RotateCcw, Sparkles, Trash2, Upload, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LazyApiImage } from "@/components/LazyApiImage"
import { RecipeSwatch } from "@/components/RecipeSwatch"
import { humanizeTag, photoRange } from "@/recipeFormat"
import { apiDelete, apiGet, apiUpload } from "@/lib/api"
import { JobRunnerPanel } from "@/JobRunnerPanel"
import { AnalysisPanel } from "@/AnalysisPanel"
import { TimelineViewer } from "@/TimelineViewer"
import { DirectorPanel } from "@/DirectorPanel"
import { AdvancedQaPanel } from "@/AdvancedQaPanel"
import { DeliveryPanel } from "@/DeliveryPanel"
import { cn } from "@/lib/utils"
import { planExhaustedReason, planIsExhausted } from "@/planFormat"
import type { AssetKind, JobSnapshot, Plan, ProjectAsset, ProjectAssets, ProjectStatus, ProjectSummary, RecipeSummary } from "@/types"

type UploadStatus = "queued" | "uploading" | "error"
type UploadItem = { id: string; file: File; kind: AssetKind; uploadIndex: number; status: UploadStatus; progress: number; error: string | null }
type WorkspaceStep = "setup" | "media" | "direct" | "review" | "deliver"
export type WorkspaceFocus = "all" | "director" | "timeline"

// One name per step, used by the stepper, the section heading and the
// "Continue to …" button alike. They used to be written out separately, which
// is how step 4 ended up called "Render & Review", "Render and review" and
// "Create & Review" on the same screen.
const workflow = [
  { id: "setup", label: "Setup", heading: "Project setup", icon: Clapperboard },
  { id: "media", label: "Media", heading: "Add photos and music", icon: Image },
  { id: "direct", label: "Direct & Edit", heading: "Direct and edit", icon: Sparkles },
  { id: "review", label: "Create & Review", heading: "Create and review", icon: Film },
  { id: "deliver", label: "Deliver", heading: "Approve and deliver", icon: PackageCheck },
] as const

function stepIndex(step: WorkspaceStep) { return workflow.findIndex((item) => item.id === step) }
function stepLabel(step: WorkspaceStep) { return workflow[stepIndex(step)].label }

function initialWorkspaceStep(fallback: WorkspaceStep): WorkspaceStep {
  const value = new URLSearchParams(window.location.search).get("step")
  return workflow.some((step) => step.id === value) ? value as WorkspaceStep : fallback
}

const accepted = {
  photo: { input: ".jpg,.jpeg,.png,.webp,.heic,.heif", mime: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]) },
  music: { input: ".mp3,.wav,.m4a,.aac,.flac,.ogg", mime: new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac", "audio/x-flac", "audio/ogg"]) },
} as const

export function AssetsPage({ project, plan, onOpenNav, onUpgrade, onRenderStarted, initialStep = "setup", focus = "all" }: { project: ProjectSummary; plan: Plan; onOpenNav: () => void; onUpgrade: () => void; onRenderStarted?: () => void; initialStep?: WorkspaceStep; focus?: WorkspaceFocus }) {
  const [step, setStep] = useState<WorkspaceStep>(() => initialWorkspaceStep(initialStep))
  const [currentProject, setCurrentProject] = useState(project)
  const [assets, setAssets] = useState<ProjectAssets | null>(null)
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [recipe, setRecipe] = useState<RecipeSummary | null>(null)
  const activeStepButton = useRef<HTMLButtonElement>(null)
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

  // On a narrow screen the stepper scrolls sideways, so landing on step 4 or 5
  // would otherwise show the active tab clipped at the edge or off-screen.
  useEffect(() => {
    activeStepButton.current?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [step])

  // `project.recipe` is the engine's slug (`jmii-silk-botanical-01`). Customers
  // picked a *name* and a look at intake, so fetch the whole recipe: the name
  // replaces the slug everywhere, and the rest drives the style preview in the
  // Direct step. A failed lookup degrades to showing the slug.
  useEffect(() => {
    const recipeId = project.recipe
    if (!recipeId) { setRecipe(null); return }
    let active = true
    apiGet<RecipeSummary>(`/recipes/${encodeURIComponent(recipeId)}`)
      .then((value) => { if (active) setRecipe(value) })
      .catch(() => { if (active) setRecipe(null) })
    return () => { active = false }
  }, [project.recipe])
  const recipeName = recipe?.name || project.recipe || null

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
    if (queue.some((item) => item.status === "uploading")) return
    const next = queue.find((item) => item.status === "queued")
    if (next) void uploadOne(next)
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
  const renderReady = currentProject.phases.render === "completed"
  const reviewReady = renderReady && currentProject.phases.qa === "completed"
  const manuallyCompleted = currentProject.manuallyCompleted
  const deliveryReady = currentProject.phases.deliver === "completed"
  const deliveryAccessible = deliveryReady || manuallyCompleted
  // Template projects used to be marked "direct: done" unconditionally, so the
  // stepper showed a tick on a step the customer had never opened. The tick now
  // means the same thing for every tier: a timeline exists.
  const completed: Record<WorkspaceStep, boolean> = { setup: true, media: mediaReady, direct: currentProject.phases.plan === "completed" || currentProject.phases.build === "completed", review: reviewReady, deliver: deliveryAccessible }
  // An already-finished film stays watchable and downloadable when the plan
  // runs dry — only starting a *new* render is gated.
  const renderBlocked = planIsExhausted(plan) && !renderReady

  function goToStep(next: WorkspaceStep) {
    setStep(next)
    const url = new URL(window.location.href)
    url.searchParams.set("step", next)
    window.history.replaceState({}, "", url)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return <>
    <header className="sticky top-0 z-20 flex h-20 items-center gap-3 border-b bg-background/95 px-3 backdrop-blur sm:gap-4 sm:px-4 md:px-10"><button aria-label="Open navigation" onClick={onOpenNav} className="grid size-11 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-4" /></button><div className="min-w-0"><p className="hidden text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground sm:block">Project workspace</p><h1 className="truncate font-serif text-base font-semibold sm:text-xl">{currentProject.name}</h1></div><Badge variant="secondary" className="hidden border-0 capitalize sm:inline-flex">{currentProject.tier}</Badge><Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={reload} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> <span className="hidden sm:inline">Refresh</span></Button></header>

    {/* Sticky under the header: the Media step is thousands of pixels tall, and
        a workflow nav you have to scroll back to the top to reach is not one. */}
    <div className="sticky top-20 z-10 border-b bg-card-soft/95 backdrop-blur"><p className="px-4 pt-2 text-xs text-muted-foreground sm:hidden">Step {stepIndex(step) + 1} of {workflow.length} · Swipe to see all steps →</p><nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-3 md:px-10" aria-label="Film workflow">{workflow.map(({ id, label, icon: Icon }, index) => <button key={id} ref={id === step ? activeStepButton : undefined} onClick={() => goToStep(id)} aria-current={step === id ? "step" : undefined} className={cn("flex min-h-11 min-w-fit flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors", step === id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground")}><span className={cn("grid size-5 place-items-center rounded-full", step === id ? "bg-white/15" : completed[id] ? "bg-success/15 text-success" : "bg-muted")}>{completed[id] ? <Check className="size-3" /> : <Icon className="size-3" />}</span><span>{index + 1}. {label}</span></button>)}</nav></div>

    <div className="mx-auto max-w-6xl px-6 py-9 md:px-10">
      {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="flex gap-2 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}</CardContent></Card>}

      {/* Surfaced from step 1 onward, not just at the Create step: uploading a
          hundred photos only to be stopped by a 402 at the very end is the
          failure this replaces. */}
      {renderBlocked && <Card className="mb-6 border-warning/40 bg-warning/10"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-warning"><span className="flex items-start gap-2"><CreditCard className="mt-0.5 size-4 shrink-0" /><span><span className="font-medium">You can build this film, but not create the video yet.</span><span className="mt-0.5 block text-xs">{planExhaustedReason(plan)}</span></span></span><Button variant="outline" size="sm" onClick={onUpgrade}>View plans <ArrowRight className="size-4" /></Button></CardContent></Card>}

      {loading && !assets && <WorkspaceSkeleton />}
      {assets && <>
      {step === "setup" && <WorkspaceSection step="setup" description="Review the creative contract before adding media.">
        <Card><CardContent className="grid gap-5 p-6 sm:grid-cols-2 lg:grid-cols-3"><ProjectFact label="Project" value={currentProject.name} /><ProjectFact label="Tier" value={currentProject.tier} /><ProjectFact label="Style" value={recipeName || (currentProject.recipe ? "Loading…" : "AI Director")} /><ProjectFact label="Language" value={currentProject.language === "vi" ? "Vietnamese" : currentProject.language === "en" ? "English" : "Not set"} /><ProjectFact label="Photo order" value={currentProject.sequenceMode || "Not set"} /><ProjectFact label="Output quality" value={currentProject.quality} /></CardContent></Card>
        <NextAction title="Setup is ready" detail="Add the source photos and soundtrack for this film." next="media" onClick={() => goToStep("media")} />
      </WorkspaceSection>}

      {step === "media" && <WorkspaceSection step="media" description="Files upload automatically after selection. Upload order is preserved for chronological edits." action={uploading ? <Badge variant="secondary" className="border-0"><RefreshCw className="mr-1 size-3 animate-spin" /> Uploading…</Badge> : undefined}>
        <Card className="mb-6"><CardContent className="grid gap-3 p-4 sm:grid-cols-2"><Requirement done={hasPhotos} label={hasPhotos ? `${assets?.photos.length} photos added` : "Add at least one photo"} /><Requirement done={hasMusic} label={hasMusic ? `${assets?.music.length} soundtrack${assets?.music.length === 1 ? "" : "s"} added` : "Add a soundtrack"} /></CardContent></Card>
        <div className="space-y-6">
          <AssetSection projectId={project.id} kind="photo" title="Wedding photos" description="JPEG, PNG, WebP or HEIC · up to 50 MB each" icon={Image} assets={assets?.photos || []} queue={queue.filter((item) => item.kind === "photo")} deleting={deleting} onFiles={(files) => addFiles("photo", files)} onRetry={uploadOne} onRemoveQueue={(id) => setQueue((current) => current.filter((item) => item.id !== id))} onDelete={removeAsset} />
          <AssetSection projectId={project.id} kind="music" title="Soundtrack" description="MP3, WAV, M4A, AAC, FLAC or OGG · up to 200 MB each" icon={Music2} assets={assets?.music || []} queue={queue.filter((item) => item.kind === "music")} deleting={deleting} onFiles={(files) => addFiles("music", files)} onRetry={uploadOne} onRemoveQueue={(id) => setQueue((current) => current.filter((item) => item.id !== id))} onDelete={removeAsset} />
        </div>
        <AnalysisPanel project={currentProject} />
        <NextAction title={mediaReady ? "Media is ready" : "Complete the media checklist"} detail={mediaReady ? "Continue to direct the story and inspect the edit." : "A film needs photos and at least one soundtrack before it can be created."} next="direct" disabled={!mediaReady} onClick={() => goToStep("direct")} />
      </WorkspaceSection>}

      {step === "direct" && <WorkspaceSection step="direct" description={currentProject.tier === "template" ? "This project follows its selected style. Create the video in the next step, then come back here to inspect the edit." : "Shape the story with AI Director, then inspect scenes and request focused revisions."}>
        {focus !== "timeline" && (currentProject.tier === "template" ? <StylePreview recipe={recipe} name={recipeName} /> : <DirectorPanel project={currentProject} />)}
        {focus !== "director" && <TimelineViewer project={currentProject} photos={assets?.photos || []} />}
        <NextAction title="Ready to create the video" detail="Rendering and quality checks will run automatically." next="review" disabled={!mediaReady} onClick={() => goToStep("review")} />
      </WorkspaceSection>}

      {step === "review" && <WorkspaceSection step="review" description="Create the video, follow its progress, then watch the result and check the quality report.">
        {!mediaReady ? <BlockedNotice message="Add photos and a soundtrack in Media before creating the video." onClick={() => goToStep("media")} /> : <JobRunnerPanel project={currentProject} renderBlocked={renderBlocked} blockedReason={planExhaustedReason(plan)} onUpgrade={onUpgrade} onRenderStarted={onRenderStarted} onJobChanged={(job) => setCurrentProject((value) => ({ ...value, status: projectStatusFromJob(job), currentPhase: job.currentPhase, progress: job.progress, error: job.error, warnings: job.warnings, manuallyCompleted: job.manuallyCompleted, phases: job.phases, updatedAt: job.updatedAt }))} />}
        <details className="mt-6 rounded-xl border bg-card" open={currentProject.status === "paused" || currentProject.status === "failed" ? true : undefined}><summary className="cursor-pointer list-none px-6 py-5 text-sm font-medium">Quality report <span className="ml-2 text-xs font-normal text-muted-foreground">Checks, automatic repairs, and anything needing a human look</span></summary><div className="border-t px-6 pb-6"><AdvancedQaPanel project={currentProject} /></div></details>
        <NextAction title={manuallyCompleted ? "Project completed manually" : deliveryReady ? "Delivery package is ready" : reviewReady ? "Your video passed quality checks" : renderReady ? `Video rendered; quality checks are running (${currentProject.progress}%)` : "Create a video first"} detail={manuallyCompleted ? "The rendered video was accepted and the project no longer requires the automated delivery gate." : deliveryReady ? "Continue to approve the exact preview and release the master." : reviewReady ? "Review the video, then continue to approval and delivery." : renderReady ? "The film is rendered. Quality checks run automatically and this page updates live." : "The video and quality report are produced automatically."} next="deliver" disabled={!reviewReady && !deliveryAccessible} onClick={() => goToStep("deliver")} />
      </WorkspaceSection>}

      {step === "deliver" && <WorkspaceSection step="deliver" description="Review the current preview, approve its exact version, then release the final files.">
        {manuallyCompleted ? <Card className="border-success/40 bg-success/5"><CardContent className="flex gap-3 p-5 text-sm"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/15 text-success"><Check className="size-5" /></span><div><p className="font-medium">Project completed manually</p><p className="mt-1 text-muted-foreground">The rendered video was accepted in {stepLabel("review")}. Automated delivery approval is not required for this project.</p></div></CardContent></Card> : !deliveryReady ? <BlockedNotice message={`Use “Create video” in ${stepLabel("review")} to produce the preview and full master.`} onClick={() => goToStep("review")} /> : <DeliveryPanel project={currentProject} />}
      </WorkspaceSection>}
      </>}
    </div>
  </>
}

function WorkspaceSection({ step, description, action, children }: { step: WorkspaceStep; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  const index = stepIndex(step)
  return <section><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><Badge variant="secondary" className="mb-3 border-0">Step {index + 1} of {workflow.length}</Badge><h2 className="font-serif text-3xl font-semibold">{workflow[index].heading}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>{action}</div>{children}</section>
}

function ProjectFact({ label, value }: { label: string; value: string }) { return <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1.5 text-sm font-medium capitalize">{value}</p></div> }

/**
 * What a Template project gets instead of the AI Director panel.
 *
 * This step used to render a single line saying direction was locked and
 * there was nothing to do — a dead end on a step the stepper still asked you
 * to visit. Showing the chosen style's look, arc and fit answers the question
 * a customer actually has here: "what is my film going to be like?"
 */
function StylePreview({ recipe, name }: { recipe: RecipeSummary | null; name: string | null }) {
  if (!recipe) {
    return <Card><CardContent className="flex gap-4 p-6"><span className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Clapperboard className="size-5" /></span><div><p className="font-medium">The style sets the direction</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{name || "The selected style"} decides the look, pacing and transitions of this film, so there is nothing to direct by hand here.</p></div></CardContent></Card>
  }
  const range = photoRange(recipe)
  return <Card className="overflow-hidden">
    <div className="grid md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <RecipeSwatch recipe={recipe} className="h-full min-h-36" />
      <CardContent className="p-6">
        <p className="text-sm leading-6 text-muted-foreground">{recipe.intro?.summary || recipe.notes}</p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {range && <span className="flex items-center gap-1.5"><Image className="size-3.5" /> {range}</span>}
          <span className="flex items-center gap-1.5"><Film className="size-3.5" /> {recipe.sceneCount} scenes · {recipe.signatureCount} looks</span>
          {recipe.energy && <span className="flex items-center gap-1.5"><Music2 className="size-3.5" /> {humanizeTag(recipe.energy)} energy</span>}
        </div>
        {recipe.storyArc.length > 0 && <div className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">How the film is told</p>
          <ol className="mt-2 flex flex-wrap items-center gap-1.5">{recipe.storyArc.map((beat, index) => <li key={`${beat}-${index}`} className="flex items-center gap-1.5"><span className="rounded-full bg-secondary px-2.5 py-1 text-xs capitalize">{humanizeTag(beat)}</span>{index < recipe.storyArc.length - 1 && <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />}</li>)}</ol>
        </div>}
        {recipe.intro?.photos && <p className="mt-4 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Works best with:</span> {recipe.intro.photos}</p>}
        <p className="mt-4 text-xs leading-5 text-muted-foreground">This style controls the look, pacing and transitions, so there is nothing to direct by hand. The scene-by-scene edit appears below once the video has been created.</p>
      </CardContent>
    </div>
  </Card>
}
function Requirement({ done, label }: { done: boolean; label: string }) { const Icon = done ? Check : Circle; return <div className={cn("flex items-center gap-3 rounded-lg border px-4 py-3 text-sm", done && "border-success/30 bg-success/5")}><Icon className={cn("size-4", done ? "text-success" : "text-muted-foreground")} /> {label}</div> }
function NextAction({ title, detail, next, disabled = false, onClick }: { title: string; detail: string; next: WorkspaceStep; disabled?: boolean; onClick: () => void }) {
  // `detail` already explains the state (and the reason, when blocked) in the
  // left-hand block; repeating it under the button just said the same sentence
  // twice side by side.
  return <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sidebar p-5 text-white">
    <div><p className="text-sm font-medium">{title}</p><p id="next-action-detail" className="mt-1 text-xs leading-5 text-sidebar-muted">{detail}</p></div>
    <Button size="lg" disabled={disabled} aria-describedby={disabled ? "next-action-detail" : undefined} onClick={onClick}>Continue to {stepLabel(next)} <ArrowRight className="size-4" /></Button>
  </div>
}
function BlockedNotice({ message, onClick }: { message: string; onClick: () => void }) { return <Card className="mb-6 border-warning/40 bg-warning/10"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm text-warning"><span className="flex items-center gap-2"><AlertCircle className="size-4" /> {message}</span><Button variant="outline" size="sm" onClick={onClick}>Fix prerequisite</Button></CardContent></Card> }

function AssetSection({ projectId, kind, title, description, icon: Icon, assets, queue, deleting, onFiles, onRetry, onRemoveQueue, onDelete }: {
  projectId: string; kind: AssetKind; title: string; description: string; icon: typeof Image; assets: ProjectAsset[]; queue: UploadItem[]; deleting: Set<string>
  onFiles: (files: File[]) => void; onRetry: (item: UploadItem) => void; onRemoveQueue: (id: string) => void; onDelete: (asset: ProjectAsset) => void
}) {
  const [dragging, setDragging] = useState(false)
  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    onFiles(Array.from(event.dataTransfer.files))
  }
  // Photos are chosen by eye, so they get a contact-sheet grid; a soundtrack
  // has nothing to look at and stays a compact list.
  const isPhoto = kind === "photo"
  return <Card className="overflow-hidden"><CardHeader><div className="flex items-start gap-3"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-5" /></div><div><CardTitle className="text-base">{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div><Badge variant="outline" className="ml-auto font-normal">{assets.length}</Badge></div></CardHeader><CardContent className="space-y-4">
    <div onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={drop} className={cn("grid place-items-center rounded-xl border border-dashed p-6 text-center transition-colors", assets.length ? "min-h-0 py-5" : "min-h-36", dragging ? "border-primary bg-primary/5" : "bg-card-soft")}><div><Upload className="mx-auto size-7 text-primary" /><p className="mt-3 text-sm font-medium">Drop {isPhoto ? "photos" : "music"} here</p><p className="mt-1 text-xs text-muted-foreground">Files upload automatically after selection</p><label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}><input type="file" multiple className="sr-only" accept={accepted[kind].input} onChange={(event) => { onFiles(Array.from(event.target.files || [])); event.target.value = "" }} />Choose files</label></div></div>
    {queue.length > 0 && <div className="divide-y rounded-lg border">{queue.map((item) => <QueueRow key={item.id} item={item} onRetry={() => onRetry(item)} onRemove={() => onRemoveQueue(item.id)} />)}</div>}
    {assets.length > 0 && (isPhoto
      ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{assets.map((asset) => <PhotoTile key={asset.id} projectId={projectId} asset={asset} deleting={deleting.has(asset.id)} onDelete={() => onDelete(asset)} />)}</div>
      : <div className="divide-y rounded-lg border">{assets.map((asset) => <div key={asset.id} className="flex items-center gap-3 p-3"><span className="grid size-8 shrink-0 place-items-center rounded-md bg-success/10 text-success"><Check className="size-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{asset.originalName}</p><p className="mt-0.5 text-xs text-muted-foreground">#{asset.uploadIndex + 1} · {formatBytes(asset.size)}</p></div><Button variant="ghost" size="icon" aria-label={`Delete ${asset.originalName}`} disabled={deleting.has(asset.id)} onClick={() => onDelete(asset)}><Trash2 className="size-4" /></Button></div>)}</div>)}
  </CardContent></Card>
}

function PhotoTile({ projectId, asset, deleting, onDelete }: { projectId: string; asset: ProjectAsset; deleting: boolean; onDelete: () => void }) {
  return <figure className={cn("group relative overflow-hidden rounded-lg border bg-card-soft transition-opacity", deleting && "opacity-40")}>
    <LazyApiImage path={`/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(asset.id)}/thumbnail`} alt={asset.originalName} className="aspect-square" />
    <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white">{asset.uploadIndex + 1}</span>
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete ${asset.originalName}`}
      disabled={deleting}
      onClick={onDelete}
      // Always reachable by keyboard and on touch; only fades in on hover for pointers.
      className="absolute right-1 top-1 size-8 bg-black/55 text-white opacity-0 hover:bg-destructive hover:text-destructive-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
    ><Trash2 className="size-3.5" /></Button>
    <figcaption className="px-2 py-1.5"><p className="truncate text-[11px] font-medium" title={asset.originalName}>{asset.originalName}</p><p className="text-[10px] text-muted-foreground">{formatBytes(asset.size)}</p></figcaption>
  </figure>
}

function QueueRow({ item, onRetry, onRemove }: { item: UploadItem; onRetry: () => void; onRemove: () => void }) {
  return <div className="p-3"><div className="flex items-center gap-3"><span className={cn("grid size-8 shrink-0 place-items-center rounded-md", item.status === "error" ? "bg-destructive/10 text-destructive" : "bg-secondary text-primary")}>{item.status === "error" ? <AlertCircle className="size-4" /> : <Upload className="size-4" />}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.file.name}</p><p className={cn("mt-0.5 truncate text-xs", item.error ? "text-destructive" : "text-muted-foreground")}>{item.error || `${formatBytes(item.file.size)} · ${item.status}`}</p></div>{item.status === "error" && <Button variant="ghost" size="icon" onClick={onRetry} aria-label={`Retry ${item.file.name}`}><RotateCcw className="size-4" /></Button>}{item.status !== "uploading" && <Button variant="ghost" size="icon" onClick={onRemove} aria-label={`Remove ${item.file.name}`}><X className="size-4" /></Button>}</div>{item.status === "uploading" && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${item.progress}%` }} /></div>}</div>
}

function byUploadIndex(left: ProjectAsset, right: ProjectAsset) { return left.uploadIndex - right.uploadIndex }
function messageOf(reason: unknown) { return reason instanceof Error ? reason.message : String(reason) }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB` }

function projectStatusFromJob(job: JobSnapshot): ProjectStatus {
  if (job.status === "pending") return "running"
  if (job.manuallyCompleted) return "completed_with_warning"
  if ((job.status === "completed" || job.status === "completed_with_warning") && job.phases.deliver !== "completed") return "paused"
  return job.status
}

function WorkspaceSkeleton() {
  return <div aria-label="Loading project media" className="animate-pulse space-y-5">
    <div className="h-8 w-48 rounded bg-muted" />
    <div className="h-20 rounded-xl bg-muted" />
    <div className="grid gap-6 lg:grid-cols-2"><div className="h-80 rounded-xl bg-muted" /><div className="h-80 rounded-xl bg-muted" /></div>
  </div>
}
