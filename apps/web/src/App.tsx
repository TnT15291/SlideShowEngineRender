import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Activity,
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  FolderOpen,
  Image,
  Layers3,
  Lightbulb,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  MoreHorizontal,
  Music2,
  Paperclip,
  Play,
  Plus,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
  X,
  ShieldAlert,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { AssetsPage } from "@/AssetsPage"
import { BillingPage } from "@/BillingPage"
import { AdminIncidentsPage } from "@/AdminIncidentsPage"
import { ChangePasswordDialog } from "@/ChangePasswordDialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { GalleryPage } from "@/GalleryPage"
import { useAuth } from "@/hooks/useAuth"
import { useProjects } from "@/hooks/useProjects"
import { IntakeWizard } from "@/IntakeWizard"
import { LoginPage } from "@/LoginPage"
import { apiGet } from "@/lib/api"
import { formatDate, initials, statusClass, statusLabel } from "@/projectFormat"
import { ProjectsPage } from "@/ProjectsPage"
import { RecipeLibrary } from "@/RecipeLibrary"
import type { IncidentList, Plan, ProjectSummary, StudioUser } from "@/types"

const starterBrief = `Bạn là một đạo diễn phim cưới theo phong cách điện ảnh Hàn Quốc.

Kể câu chuyện của Linh và Nam từ những ngày yêu xa đến lễ cưới. Mở đầu nhẹ nhàng, phát triển cảm xúc chậm, cao trào tại khoảnh khắc trao nhẫn và kết thúc bằng cảnh hai người rời lễ đường.

Ưu tiên ảnh có tương tác tự nhiên, ánh mắt và gia đình. Màu phim ấm, ít hiệu ứng, chuyển cảnh mềm. Không dùng caption sáo rỗng.`

const moods = ["Cinematic", "Emotional", "Warm", "Elegant", "Documentary"]
const nav = [
  [WandSparkles, "AI Director", true],
  [FolderOpen, "Projects", false],
  [Image, "Assets", false],
  [Layers3, "Timeline", false],
  [Film, "Render queue", false],
] as const

type AppView = "dashboard" | "director" | "intake" | "projects" | "recipes" | "assets" | "gallery" | "billing" | "admin"

function routeFromUrl(): { view: AppView; projectId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get("view")
  const view = raw === "project" ? "assets"
    : raw === "director" || raw === "intake" || raw === "projects" || raw === "recipes" || raw === "gallery" || raw === "billing" || raw === "admin" ? raw
    : "dashboard"
  return { view, projectId: params.get("project") }
}

export function App() {
  const { user, loading, login, register, logout, reloadUser } = useAuth()
  const initialRoute = useMemo(routeFromUrl, [])
  const [view, setView] = useState<AppView>(initialRoute.view)
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null)
  const [routeLoading, setRouteLoading] = useState(initialRoute.view === "assets")

  function navigate(next: AppView, project?: ProjectSummary) {
    setView(next)
    if (project) setActiveProject(project)
    setRouteLoading(false)
    const url = new URL(window.location.href)
    url.searchParams.set("view", next === "assets" ? "project" : next)
    const projectId = project?.id || (next === "assets" ? activeProject?.id : null)
    if (projectId) url.searchParams.set("project", projectId)
    else url.searchParams.delete("project")
    if (next !== "assets") url.searchParams.delete("step")
    window.history.pushState({}, "", url)
  }

  useEffect(() => {
    if (!user) return
    let active = true
    async function syncRoute() {
      const route = routeFromUrl()
      setView(route.view)
      if (route.view !== "assets" || !route.projectId) { if (active) setRouteLoading(false); return }
      setRouteLoading(true)
      try {
        const project = await apiGet<ProjectSummary>(`/projects/${encodeURIComponent(route.projectId)}`)
        if (active) setActiveProject(project)
      } catch {
        if (active) setView("projects")
      } finally {
        if (active) setRouteLoading(false)
      }
    }
    void syncRoute()
    const onPopState = () => { void syncRoute() }
    window.addEventListener("popstate", onPopState)
    return () => { active = false; window.removeEventListener("popstate", onPopState) }
  }, [user])

  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Loading…</main>
  // Reachable with zero login — checked before the auth gate below.
  if (view === "gallery") return <GalleryPage onBack={() => navigate("dashboard")} />
  if (!user) return <LoginPage onLogin={login} onRegister={register} onBrowseGallery={() => navigate("gallery")} />
  if (routeLoading) return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Opening project…</main>

  if (view === "director") return <DirectorWorkspace onBack={() => navigate("dashboard")} />
  if (view === "intake") return <IntakeWizard onBack={() => navigate("dashboard")} onCreated={(project) => navigate("assets", project)} />
  if (view === "projects") return <ProjectsPage onBack={() => navigate("dashboard")} onOpen={(project) => navigate("assets", project)} />
  if (view === "assets" && activeProject) return <AssetsPage project={activeProject} onBack={() => navigate("projects")} onRenderStarted={reloadUser} />
  if (view === "recipes") return <RecipeLibrary onBack={() => navigate("dashboard")} />
  if (view === "billing") return <BillingPage onBack={() => navigate("dashboard")} />
  if (view === "admin") return <AdminIncidentsPage onBack={() => navigate("dashboard")} />
  return <Dashboard user={user} onLogout={logout} onCreate={() => navigate("intake")} onDirector={() => navigate("projects")} onBrowseProjects={() => navigate("projects")} onBrowseRecipes={() => navigate("recipes")} onUpgrade={() => navigate("billing")} onAdmin={() => navigate("admin")} onReloadUser={reloadUser} />
}

function Dashboard({ user, onLogout, onCreate, onDirector, onBrowseProjects, onBrowseRecipes, onUpgrade, onAdmin, onReloadUser }: { user: StudioUser; onLogout: () => void; onCreate: () => void; onDirector: () => void; onBrowseProjects: () => void; onBrowseRecipes: () => void; onUpgrade: () => void; onAdmin: () => void; onReloadUser: () => void }) {
  const [navOpen, setNavOpen] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [checkoutBanner, setCheckoutBanner] = useState<"success" | "cancelled" | null>(null)
  const [incidentCount, setIncidentCount] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get("checkout")
    if (checkout !== "success" && checkout !== "cancelled") return
    setCheckoutBanner(checkout)
    if (checkout === "success") onReloadUser()
    const url = new URL(window.location.href)
    url.searchParams.delete("checkout")
    window.history.replaceState({}, "", url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (user.username !== "storeel") return
    apiGet<IncidentList>("/admin/incidents").then((result) => setIncidentCount(result.openCount)).catch(() => undefined)
  }, [user.username])
  const dashboardNav = [
    [LayoutDashboard, "Dashboard", true],
    [FolderOpen, "Projects", false],
    [Sparkles, "Recipe Library", false],
    [Image, "Assets", false],
    [WandSparkles, "AI Director", false],
    [Layers3, "Timeline", false],
    [Film, "Render queue", false],
  ] as const

  const { data, error, loading, reload } = useProjects()
  const projects = data?.projects || []
  const featured = projects.find((project) => project.status === "running" || project.status === "paused") || projects[0]
  const counts = {
    total: projects.length,
    running: projects.filter((project) => project.status === "running").length,
    paused: projects.filter((project) => project.status === "paused").length,
    completed: projects.filter((project) => project.status === "completed").length,
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      {navOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-72 flex-col border-r border-white/10 bg-sidebar px-4 py-6 text-sidebar-foreground lg:static lg:z-auto lg:flex lg:w-64", navOpen ? "flex" : "hidden lg:flex")}>
        <div className="flex items-center justify-between">
          <button onClick={() => undefined} className="flex items-center gap-3 px-2 text-left">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Clapperboard className="size-5" /></div>
            <div><div className="font-serif text-xl font-semibold tracking-tight">StoReel</div><div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-muted">Moments That Move</div></div>
          </button>
          <button onClick={() => setNavOpen(false)} className="grid size-8 place-items-center rounded-md text-sidebar-muted hover:bg-white/5 hover:text-white lg:hidden"><X className="size-4" /></button>
        </div>
        <Button onClick={onCreate} className="mt-8 w-full justify-start bg-white text-sidebar hover:bg-white/90" size="lg"><Plus className="size-4" /> New film</Button>
        <nav className="mt-8 space-y-1">
          {dashboardNav.map(([Icon, label, active]) => {
            const onClick = label === "AI Director" ? onDirector : label === "Projects" ? onBrowseProjects : label === "Recipe Library" ? onBrowseRecipes : undefined
            return <button key={label} onClick={() => { onClick?.(); setNavOpen(false) }} className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white")}><Icon className="size-[18px]" /> {label}</button>
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-5">
          <p className="truncate text-sm font-medium">{user.username}</p>
          <p className={cn("mt-1 text-xs", planIsExhausted(user.plan) ? "text-amber-400" : "text-sidebar-muted")}>{planSummary(user.plan)}</p>
          <button onClick={onUpgrade} className="mt-2 text-xs text-primary underline underline-offset-2 hover:text-primary/80">{user.plan.type === "subscription" ? "Manage billing" : "Upgrade"}</button>
          <button onClick={() => setChangingPassword(true)} className="mt-3 flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"><KeyRound className="size-4" /> Change password</button>
          {user.username === "storeel" && <button onClick={onAdmin} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"><ShieldAlert className="size-4" /> Technical incidents {incidentCount > 0 && <Badge className="ml-auto border-0 bg-amber-500 text-white">{incidentCount}</Badge>}</button>}
          <button onClick={onLogout} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"><LogOut className="size-4" /> Sign out</button>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between gap-3 border-b px-4 md:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setNavOpen(true)} className="grid size-9 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-5" /></button>
            <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Project workspace</p><h1 className="truncate font-serif text-xl font-semibold">Good morning, welcome back</h1></div>
          </div>
          <Button onClick={onCreate} size="lg" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">Create new film</span></Button>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-8 md:px-10">
          {checkoutBanner === "success" && <Card className="border-success/40 bg-success/5"><CardContent className="flex items-center justify-between gap-4 p-5 text-sm text-success"><span>Payment received — your plan will update as soon as Stripe confirms it (usually a few seconds).</span><Button variant="outline" size="sm" onClick={() => setCheckoutBanner(null)}>Dismiss</Button></CardContent></Card>}
          {checkoutBanner === "cancelled" && <Card className="border-amber-300 bg-amber-50"><CardContent className="flex items-center justify-between gap-4 p-5 text-sm text-amber-900"><span>Checkout was cancelled — no charge was made.</span><Button variant="outline" size="sm" onClick={() => setCheckoutBanner(null)}>Dismiss</Button></CardContent></Card>}
          {error && <Card className="border-destructive/40 bg-destructive/5"><CardContent className="flex items-center justify-between gap-4 p-5 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={reload}>Retry</Button></CardContent></Card>}
          {data && data.issues.length > 0 && <Card className="border-amber-300 bg-amber-50"><CardContent className="p-5 text-sm text-amber-900">{data.issues.length} project folder(s) contain invalid data. Open Projects for details.</CardContent></Card>}
          <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            {featured ? <Card className="relative min-h-[360px] overflow-hidden border-0 bg-[linear-gradient(135deg,#3a302b_0%,#7b5a42_52%,#c9a878_100%)] text-white shadow-xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(255,255,255,.22),transparent_35%),linear-gradient(to_top,rgba(14,12,11,.78),transparent_65%)]" />
              <div className="absolute right-10 top-12 grid size-36 place-items-center rounded-full border border-white/20 bg-white/10 font-serif text-5xl backdrop-blur-sm">{initials(featured.name)}</div>
              <div className="relative flex min-h-[360px] flex-col justify-end p-8">
                <Badge className="mb-4 w-fit border-0 bg-white/15 text-white">{statusLabel[featured.status]}</Badge>
                <h2 className="font-serif text-4xl font-semibold">{featured.name}</h2><p className="mt-1 text-white/75 capitalize">{featured.tier} · {featured.currentPhase || "Not started"} · Updated {formatDate(featured.updatedAt)}</p>
                <div className="mt-6 flex gap-3"><Button variant="secondary" onClick={onBrowseProjects}><FolderOpen className="size-4" /> Open projects</Button><Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white"><MoreHorizontal className="size-5" /></Button></div>
              </div>
            </Card> : <Card className="grid min-h-[360px] place-items-center border-dashed"><CardContent className="text-center"><FolderOpen className="mx-auto size-10 text-muted-foreground" /><h2 className="mt-4 font-serif text-2xl font-semibold">No projects yet</h2><p className="mt-2 text-sm text-muted-foreground">Create a new film to begin.</p><Button className="mt-5" onClick={onCreate}><Plus className="size-4" /> Create new film</Button></CardContent></Card>}

            <div className="grid gap-4 sm:grid-cols-2">
              <Metric icon={FolderOpen} value={String(counts.total)} label="Projects" detail="All project folders" />
              <Metric icon={Film} value={String(counts.running)} label="Running" detail="Active pipeline jobs" />
              <Metric icon={Layers3} value={String(counts.paused)} label="Paused" detail="Waiting for a decision" />
              <Metric icon={Check} value={String(counts.completed)} label="Completed" detail="Delivered or finished" />
            </div>
          </div>

          {featured && <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Pipeline progress</CardTitle><CardDescription>{featured.name} · <span className="capitalize">{featured.currentPhase || "not started"}</span></CardDescription></div><span className="font-serif text-3xl font-semibold text-primary">{featured.progress}%</span></CardHeader><CardContent><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${featured.progress}%` }} /></div><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", featured.status === "failed" || featured.status === "invalid" ? "bg-red-500" : featured.status === "paused" ? "bg-amber-500" : "bg-success")} /> {statusLabel[featured.status]}</span><span>Updated {formatDate(featured.updatedAt)}</span></div>{featured.error && <p className="mt-3 text-xs text-destructive">{featured.error}</p>}</CardContent></Card>}

          <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Recent projects</CardTitle><CardDescription>{loading ? "Loading project folders…" : "Ordered by latest job update"}</CardDescription></div><Button variant="ghost" size="sm" onClick={onBrowseProjects}>View all <ArrowRight className="size-4" /></Button></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{projects.slice(0, 4).map((project, index) => <button onClick={onBrowseProjects} key={project.id} className="overflow-hidden rounded-lg border bg-background text-left"><div className={cn("grid h-28 place-items-center font-serif text-2xl text-white", ["bg-[#8b7869]", "bg-[#65705f]", "bg-[#9b745d]", "bg-[#687a87]"][index])}>{initials(project.name)}</div><div className="p-3"><p className="text-sm font-medium">{project.name}</p><p className="mt-0.5 text-xs capitalize text-muted-foreground">{project.tier} · {project.currentPhase || "not started"}</p><Badge className={cn("mt-3 border-0", statusClass[project.status])}>{statusLabel[project.status]}</Badge></div></button>)}{!loading && projects.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">No recent projects.</p>}</CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4 text-primary" /> Activity</CardTitle><CardDescription>Latest project updates</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">{projects.slice(0, 4).map((project) => <ActivityRow key={project.id} title={`${project.name}: ${statusLabel[project.status]}`} time={formatDate(project.updatedAt)} />)}{!loading && projects.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>}</CardContent></Card>
          </div>
        </div>
      </section>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </main>
  )
}

function DirectorWorkspace({ onBack }: { onBack: () => void }) {
  const [brief, setBrief] = useState(starterBrief)
  const [selectedMoods, setSelectedMoods] = useState(["Cinematic", "Warm"])
  const [generated, setGenerated] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const wordCount = useMemo(() => brief.trim().split(/\s+/).filter(Boolean).length, [brief])

  function toggleMood(mood: string) {
    setSelectedMoods((current) => current.includes(mood) ? current.filter((item) => item !== mood) : [...current, mood])
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      {navOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-72 flex-col border-r border-white/10 bg-sidebar px-4 py-6 text-sidebar-foreground lg:static lg:z-auto lg:flex lg:w-64", navOpen ? "flex" : "hidden lg:flex")}>
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-3 px-2 text-left">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <Clapperboard className="size-5" />
            </div>
            <div>
              <div className="font-serif text-xl font-semibold tracking-tight">StoReel</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-muted">Moments That Move</div>
            </div>
          </button>
          <button onClick={() => setNavOpen(false)} className="grid size-8 place-items-center rounded-md text-sidebar-muted hover:bg-white/5 hover:text-white lg:hidden"><X className="size-4" /></button>
        </div>

        <Button className="mt-8 w-full justify-start bg-white text-sidebar hover:bg-white/90" size="lg">
          <Plus className="size-4" /> New film
        </Button>

        <nav className="mt-8 space-y-1">
          {nav.map(([Icon, label, active]) => (
            <button key={label} onClick={() => { if (label === "Projects") onBack(); setNavOpen(false) }} className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white")}>
              <Icon className="size-[18px]" /> {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Lightbulb className="size-4 text-primary" /> Director tip</div>
          <p className="mt-2 text-xs leading-5 text-sidebar-muted">Describe the feeling and key moments. StoReel will shape the structure for you.</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur md:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setNavOpen(true)} className="grid size-9 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-5" /></button>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">AI Director</p>
              <h1 className="truncate font-serif text-xl font-semibold">Create a new film</h1>
            </div>
          </div>
          <button className="hidden items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left shadow-sm sm:flex">
            <div className="grid size-8 place-items-center rounded-md bg-secondary text-xs font-semibold">LN</div>
            <div className="hidden sm:block"><div className="text-xs font-medium">Linh & Nam</div><div className="text-[11px] text-muted-foreground">Wedding film</div></div>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </header>

        <div className="mx-auto max-w-[1440px] px-6 py-8 md:px-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <Badge variant="secondary" className="mb-3 gap-1.5 border-0"><Sparkles className="size-3" /> Creative brief</Badge>
              <h2 className="max-w-3xl font-serif text-4xl font-semibold tracking-tight md:text-5xl">Tell us the story you want to create.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Give your AI Director a role, story outline, mood, important moments, pacing, music notes, and anything it should follow.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="grid size-5 place-items-center rounded-full bg-success text-white"><Check className="size-3" /></span> Draft saved</div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.75fr)]">
            <div className="space-y-6">
              <Card className="overflow-hidden border-border/80 shadow-[0_20px_60px_-40px_rgba(62,43,27,.35)]">
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-card-soft px-6 py-4">
                  <div><CardTitle className="text-base">Director instructions</CardTitle><CardDescription className="mt-1">Write naturally. Details help StoReel make better choices.</CardDescription></div>
                  <Badge variant="outline" className="font-normal">{wordCount} words</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <textarea
                    value={brief}
                    onChange={(event) => { setBrief(event.target.value); setGenerated(false) }}
                    className="min-h-[330px] w-full resize-none bg-card px-7 py-6 text-[15px] leading-7 outline-none placeholder:text-muted-foreground/70"
                    placeholder="Describe the story, emotions, visual direction, important moments, pacing, music, and anything the AI Director should follow…"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card-soft px-5 py-4">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm"><Paperclip className="size-4" /> Attach brief</Button>
                      <Button variant="ghost" size="sm"><Image className="size-4" /> Add references</Button>
                    </div>
                    <span className="text-xs text-muted-foreground">⌘ + Enter to generate</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Creative direction</CardTitle><CardDescription>Optional signals that guide the first set of directions.</CardDescription></CardHeader>
                <CardContent className="grid gap-6 md:grid-cols-3">
                  <label className="space-y-2 text-sm font-medium">Duration<select className="field"><option>3–5 minutes</option><option>Under 3 minutes</option><option>5–8 minutes</option></select></label>
                  <label className="space-y-2 text-sm font-medium">Format<select className="field"><option>16:9 Landscape</option><option>9:16 Vertical</option><option>1:1 Square</option></select></label>
                  <label className="space-y-2 text-sm font-medium">Music direction<select className="field"><option>Let AI decide</option><option>Follow selected track</option><option>Soft and cinematic</option></select></label>
                  <div className="md:col-span-3">
                    <p className="mb-3 text-sm font-medium">Mood</p>
                    <div className="flex flex-wrap gap-2">{moods.map((mood) => <button key={mood} onClick={() => toggleMood(mood)} className={cn("rounded-full border px-3.5 py-2 text-xs font-medium transition-colors", selectedMoods.includes(mood) ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:bg-muted")}>{selectedMoods.includes(mood) && <Check className="mr-1.5 inline size-3" />}{mood}</button>)}</div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sidebar p-5 text-white">
                <div><p className="text-sm font-medium">Ready to explore the story?</p><p className="mt-1 text-xs text-sidebar-muted">StoReel will create 3 distinct directorial approaches for review.</p></div>
                <Button onClick={() => setGenerated(true)} size="lg" disabled={!brief.trim()}><Sparkles className="size-4" /> Generate directions <ArrowRight className="size-4" /></Button>
              </div>
            </div>

            <aside className="space-y-6">
              <Card className={cn("transition-colors", generated && "border-primary/40")}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" /> AI understanding</CardTitle><CardDescription className="mt-1">What your director will follow</CardDescription></div>
                  <Badge variant={generated ? "default" : "secondary"}>{generated ? "Updated" : "Live"}</Badge>
                </CardHeader>
                <CardContent className="space-y-5 text-sm">
                  <Summary label="Director role" value="Korean cinematic wedding filmmaker" />
                  <Separator />
                  <Summary label="Story arc" value="Long-distance love → wedding day → leaving the ceremony together" />
                  <Separator />
                  <Summary label="Emotional peak" value="Ring exchange and family connection" />
                  <Separator />
                  <Summary label="Visual language" value="Warm palette, soft transitions, natural interaction, minimal effects" />
                  <Separator />
                  <Summary label="Avoid" value="Cliché captions and overly dramatic effects" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Proposed story flow</CardTitle><CardDescription>The structure updates as you refine the brief.</CardDescription></CardHeader>
                <CardContent className="space-y-1">
                  <Chapter number="01" title="Distance" detail="Quiet opening · letters and waiting" />
                  <Chapter number="02" title="Coming home" detail="Momentum builds · shared moments" />
                  <Chapter number="03" title="The promise" detail="Emotional peak · ring exchange" />
                  <Chapter number="04" title="Together" detail="Warm resolution · leaving as one" last />
                </CardContent>
              </Card>

              <Card className="bg-card-soft">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary"><Music2 className="size-5 text-primary" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">a thousand years.mp3</p><p className="text-xs text-muted-foreground">04:45 · selected soundtrack</p></div>
                  <Button variant="ghost" size="icon"><Play className="size-4" /></Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </section>
    </main>
  )
}

function planSummary(plan: Plan): string {
  if (plan.type === "per_video") {
    return plan.creditsRemaining === 1 ? "1 render credit left" : `${plan.creditsRemaining} render credits left`
  }
  return `${plan.rendersUsedThisPeriod} of ${plan.monthlyRenderQuota} renders used this period`
}

function planIsExhausted(plan: Plan): boolean {
  return plan.type === "per_video" ? plan.creditsRemaining <= 0 : plan.rendersUsedThisPeriod >= plan.monthlyRenderQuota
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="leading-6">{value}</p></div>
}

function Metric({ icon: Icon, value, label, detail }: { icon: typeof Film; value: string; label: string; detail: string }) {
  return <Card><CardContent className="p-5"><div className="grid size-9 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-4" /></div><p className="mt-5 font-serif text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p><p className="mt-3 text-xs text-success">{detail}</p></CardContent></Card>
}

function ActivityRow({ title, time }: { title: string; time: string }) {
  return <div className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><div className="min-w-0 flex-1"><p className="truncate">{title}</p><p className="mt-1 text-xs text-muted-foreground">{time}</p></div></div>
}

function Chapter({ number, title, detail, last = false }: { number: string; title: string; detail: string; last?: boolean }) {
  return <div className="relative flex gap-3 pb-5"><div className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-background text-[10px] font-semibold text-primary">{number}</div>{!last && <div className="absolute left-[15px] top-8 h-full w-px bg-border" />}<div className="pt-1"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p></div></div>
}
