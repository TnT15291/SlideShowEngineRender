import { useEffect, useMemo, useState } from "react"
import {
  ArrowRight,
  Check,
  Clapperboard,
  Film,
  FolderOpen,
  Layers3,
  LayoutDashboard,
  KeyRound,
  LogOut,
  Menu,
  Plus,
  Sparkles,
  X,
  ShieldAlert,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { AssetsPage, type WorkspaceFocus } from "@/AssetsPage"
import { BillingPage } from "@/BillingPage"
import { AdminIncidentsPage } from "@/AdminIncidentsPage"
import { ChangePasswordDialog } from "@/ChangePasswordDialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LanguageToggle } from "@/components/LanguageToggle"
import { cn } from "@/lib/utils"
import { GalleryPage } from "@/GalleryPage"
import { useAuth } from "@/hooks/useAuth"
import { useProjects } from "@/hooks/useProjects"
import { useI18n, type Translate } from "@/lib/i18n"
import { IntakeWizard } from "@/IntakeWizard"
import { LoginPage } from "@/LoginPage"
import { apiGet } from "@/lib/api"
import type { StringKey } from "@/lib/strings"
import { useApiObjectUrl } from "@/lib/use-api-object-url"
import { planIsExhausted, planSummary } from "@/planFormat"
import { formatDate, initials, phaseLabelKey, statusClass, statusDotClass, statusLabelKey, tierLabelKey } from "@/projectFormat"
import { ProjectsPage } from "@/ProjectsPage"
import { RecipeLibrary } from "@/RecipeLibrary"
import type { IncidentList, ProjectSummary, StudioUser } from "@/types"

type AppView = "dashboard" | "director" | "timeline" | "render" | "intake" | "projects" | "recipes" | "assets" | "gallery" | "billing" | "admin"

function routeFromUrl(): { view: AppView; projectId: string | null } {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get("view")
  const view = raw === "project" ? "assets"
    : raw === "director" || raw === "timeline" || raw === "render" || raw === "assets" || raw === "intake" || raw === "projects" || raw === "recipes" || raw === "gallery" || raw === "billing" || raw === "admin" ? raw
    : "dashboard"
  return { view, projectId: params.get("project") }
}

export function App() {
  const { t } = useI18n()
  const { user, loading, login, register, logout, reloadUser } = useAuth()
  const initialRoute = useMemo(routeFromUrl, [])
  const [view, setView] = useState<AppView>(initialRoute.view)
  const [activeProject, setActiveProject] = useState<ProjectSummary | null>(null)
  const [routeLoading, setRouteLoading] = useState(["assets", "director", "timeline", "render"].includes(initialRoute.view) && Boolean(initialRoute.projectId))
  const [navOpen, setNavOpen] = useState(false)

  function navigate(next: AppView, project?: ProjectSummary) {
    const projectView = ["assets", "director", "timeline", "render"].includes(next)
    const retainedProject = project || (projectView ? activeProject : null)
    if (projectView && !retainedProject) {
      const retainedId = window.sessionStorage.getItem("storeel.activeProjectId")
      if (retainedId) {
        setRouteLoading(true)
        apiGet<ProjectSummary>(`/projects/${encodeURIComponent(retainedId)}`)
          .then((savedProject) => navigate(next, savedProject))
          .catch(() => {
            window.sessionStorage.removeItem("storeel.activeProjectId")
            setView(next)
            setRouteLoading(false)
          })
        return
      }
    }
    setView(next)
    if (retainedProject) {
      setActiveProject(retainedProject)
      window.sessionStorage.setItem("storeel.activeProjectId", retainedProject.id)
    }
    setRouteLoading(false)
    const url = new URL(window.location.href)
    url.searchParams.set("view", next === "assets" ? "project" : next)
    const projectId = retainedProject?.id
    if (projectId) url.searchParams.set("project", projectId)
    else url.searchParams.delete("project")
    url.searchParams.delete("step")
    window.history.pushState({}, "", url)
  }

  useEffect(() => { setNavOpen(false) }, [view])

  useEffect(() => {
    if (!user) return
    let active = true
    async function syncRoute() {
      const route = routeFromUrl()
      setView(route.view)
      if (!["assets", "director", "timeline", "render"].includes(route.view) || !route.projectId) {
        if (active) setRouteLoading(false)
        return
      }
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

  if (loading) return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">{t("common.loading")}</main>
  // Reachable with zero login — checked before the auth gate below.
  if (view === "gallery") return <GalleryPage onBack={() => navigate("dashboard")} />
  if (!user) return <LoginPage onLogin={login} onRegister={register} onBrowseGallery={() => navigate("gallery")} />
  if (routeLoading) return <main className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">{t("app.openingProject")}</main>

  // The intake wizard is a focused, linear, exit-avoiding flow and isn't a
  // top-level nav destination, so it intentionally stays outside the shell.
  if (view === "intake") return <IntakeWizard onBack={() => navigate("dashboard")} onCreated={(project) => navigate("assets", project)} />

  const onOpenNav = () => setNavOpen(true)
  const shell = { user, active: view, navOpen, onCloseNav: () => setNavOpen(false), onNavigate: navigate, onCreate: () => navigate("intake"), onUpgrade: () => navigate("billing"), onAdmin: () => navigate("admin"), onLogout: logout }

  if (view === "projects") return <AppShell {...shell}><ProjectsPage onOpenNav={onOpenNav} onOpen={(project) => navigate("assets", project)} /></AppShell>
  if (["assets", "director", "timeline", "render"].includes(view) && !activeProject) {
    const labels = toolRoute(view, t)
    return <AppShell {...shell}><ProjectsPage onOpenNav={onOpenNav} title={labels.title} description={labels.description} onOpen={(project) => navigate(view, project)} /></AppShell>
  }
  if (activeProject && ["assets", "director", "timeline", "render"].includes(view)) {
    const config: Record<"assets" | "director" | "timeline" | "render", { step: "media" | "direct" | "review"; focus: WorkspaceFocus }> = {
      assets: { step: "media", focus: "all" },
      director: { step: "direct", focus: "director" },
      timeline: { step: "direct", focus: "timeline" },
      render: { step: "review", focus: "all" },
    }
    const selected = config[view as keyof typeof config]
    return <AppShell {...shell}><AssetsPage key={`${activeProject.id}:${view}`} project={activeProject} initialStep={selected.step} focus={selected.focus} plan={user.plan} onOpenNav={onOpenNav} onUpgrade={() => navigate("billing")} onRenderStarted={reloadUser} /></AppShell>
  }
  if (view === "recipes") return <AppShell {...shell}><RecipeLibrary onOpenNav={onOpenNav} /></AppShell>
  if (view === "billing") return <AppShell {...shell}><BillingPage onOpenNav={onOpenNav} /></AppShell>
  if (view === "admin") return <AppShell {...shell}><AdminIncidentsPage onOpenNav={onOpenNav} /></AppShell>
  return <AppShell {...shell}><Dashboard onOpenNav={onOpenNav} onCreate={() => navigate("intake")} onNavigate={navigate} onReloadUser={reloadUser} /></AppShell>
}

function toolRoute(view: AppView, t: Translate) {
  if (view === "assets") return { title: t("route.assets.title"), description: t("route.assets.description") }
  if (view === "director") return { title: t("route.director.title"), description: t("route.director.description") }
  if (view === "timeline") return { title: t("route.timeline.title"), description: t("route.timeline.description") }
  return { title: t("route.render.title"), description: t("route.render.description") }
}

// Persistent app shell used by every authenticated, top-level section so the
// sidebar (and its active-item highlight) stays consistent no matter which
// page is open — previously only the Dashboard rendered it, so navigating
// anywhere else lost the sidebar entirely.
function AppShell({ user, active, navOpen, onCloseNav, onNavigate, onCreate, onUpgrade, onAdmin, onLogout, children }: {
  user: StudioUser
  active: AppView
  navOpen: boolean
  onCloseNav: () => void
  onNavigate: (view: AppView) => void
  onCreate: () => void
  onUpgrade: () => void
  onAdmin: () => void
  onLogout: () => void
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const [changingPassword, setChangingPassword] = useState(false)
  const [incidentList, setIncidentList] = useState<IncidentList | null>(null)

  useEffect(() => {
    if (!user.isAdmin) return
    apiGet<IncidentList>("/admin/incidents").then(setIncidentList).catch(() => undefined)
  }, [user.isAdmin])

  // Only true top-level destinations live here. Assets / AI Director /
  // Timeline / Render used to sit alongside them, but they are steps *inside* a
  // project, so picking one without a project just bounced you to a project
  // picker — and they duplicated the workspace stepper under different names.
  // Deep links to those views still resolve; they are simply not nav items.
  const navItems = [
    [LayoutDashboard, "nav.dashboard", "dashboard"],
    [FolderOpen, "nav.projects", "projects"],
    [Sparkles, "nav.recipes", "recipes"],
  ] as const satisfies ReadonlyArray<readonly [typeof Film, StringKey, AppView]>
  const projectViews: AppView[] = ["assets", "director", "timeline", "render"]

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      {navOpen && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={onCloseNav} />}
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-72 flex-col border-r border-white/10 bg-sidebar px-4 py-6 text-sidebar-foreground lg:static lg:z-auto lg:flex lg:w-64", navOpen ? "flex" : "hidden lg:flex")}>
        <div className="flex items-center justify-between">
          <button onClick={() => onNavigate("dashboard")} className="flex items-center gap-3 px-2 text-left">
            <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Clapperboard className="size-5" /></div>
            <div><div className="font-serif text-xl font-semibold tracking-tight">StoReel</div><div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-muted">{t("brand.tagline")}</div></div>
          </button>
          <button aria-label={t("common.closeNavigation")} onClick={onCloseNav} className="grid size-11 place-items-center rounded-md text-sidebar-muted hover:bg-white/5 hover:text-white lg:hidden"><X className="size-4" /></button>
        </div>
        <Button onClick={onCreate} className="mt-8 w-full justify-start bg-white text-sidebar hover:bg-white/90" size="lg"><Plus className="size-4" /> {t("app.newFilm")}</Button>
        <nav className="mt-8 space-y-1">
          {navItems.map(([Icon, labelKey, id]) => {
            // A project workspace is reached through Projects, so keep that
            // item lit while the user is inside one.
            const current = active === id || (id === "projects" && projectViews.includes(active))
            return <button key={id} onClick={() => onNavigate(id)} aria-current={current ? "page" : undefined} className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors", current ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white")}><Icon className="size-[18px]" /> {t(labelKey)}</button>
          })}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-5">
          <p className="truncate text-sm font-medium">{user.username}</p>
          <p className={cn("mt-1 text-xs", planIsExhausted(user.plan) ? "text-amber-400" : "text-sidebar-muted")}>{planSummary(user.plan, t)}</p>
          <button onClick={onUpgrade} className={cn("mt-2 text-xs transition-colors hover:text-white", active === "billing" ? "font-semibold text-white" : "text-sidebar-muted")}>{t("nav.billing")}</button>
          <button onClick={() => setChangingPassword(true)} className="mt-3 flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"><KeyRound className="size-4" /> {t("nav.changePassword")}</button>
          {user.isAdmin && <button onClick={onAdmin} className={cn("flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm transition-colors", active === "admin" ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white")}><ShieldAlert className="size-4" /> {t("nav.incidents")}{incidentList && incidentList.openCount > 0 && <Badge className="ml-auto border-0 bg-warning text-warning-foreground">{incidentList.openCount}</Badge>}</button>}
          <button onClick={onLogout} className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-sidebar-muted transition-colors hover:bg-white/5 hover:text-white"><LogOut className="size-4" /> {t("nav.signOut")}</button>
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/10 pt-4">
            <span className="text-xs text-sidebar-muted">{t("common.language")}</span>
            <LanguageToggle tone="dark" />
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </main>
  )
}

function Dashboard({ onOpenNav, onCreate, onNavigate, onReloadUser }: { onOpenNav: () => void; onCreate: () => void; onNavigate: (view: AppView, project?: ProjectSummary) => void; onReloadUser: () => void }) {
  const { t, locale } = useI18n()
  const [checkoutBanner, setCheckoutBanner] = useState<"success" | "cancelled" | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const checkout = params.get("checkout")
    if (checkout !== "success" && checkout !== "cancelled") return
    setCheckoutBanner(checkout)
    if (checkout === "success") onReloadUser()
    const url = new URL(window.location.href)
    url.searchParams.delete("checkout")
    url.searchParams.delete("provider")
    window.history.replaceState({}, "", url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data, error, loading, reload } = useProjects()
  const projects = data?.projects || []
  const featured = projects.find((project) => project.status === "running" || project.status === "paused") || projects[0]
  const counts = {
    total: projects.length,
    running: projects.filter((project) => project.status === "running").length,
    paused: projects.filter((project) => project.status === "paused").length,
    completed: projects.filter((project) => project.status === "completed").length,
  }
  const onBrowseProjects = () => onNavigate("projects")

  // "Needs attention" and the invalid-data banner used to read from different
  // sources, so the page could warn "1 project has invalid data" directly above
  // a panel insisting "No paused, failed, or invalid projects". Unreadable
  // folders never reach `projects` at all, so they have to be merged in here.
  const attentionItems: AttentionItem[] = [
    ...(data?.issues || []).map((issue) => ({
      key: `issue:${issue.projectId}`,
      title: t("dashboard.issueTitle", { id: issue.projectId }),
      detail: issue.message,
      severe: true,
      onSelect: onBrowseProjects,
    })),
    ...projects
      .filter((project) => project.status === "paused" || project.status === "failed" || project.status === "invalid" || project.status === "completed_with_warning")
      .map((project) => ({
        key: `project:${project.id}`,
        title: `${project.name}: ${t(statusLabelKey[project.status])}`,
        detail: t("dashboard.updatedAt", { date: formatDate(project.updatedAt, locale) }),
        severe: project.status === "failed" || project.status === "invalid",
        onSelect: () => onNavigate("assets", project),
      })),
  ]

  return (
    <>
      <header className="flex h-20 items-center justify-between gap-3 border-b px-4 md:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <button aria-label={t("common.openNavigation")} onClick={onOpenNav} className="grid size-11 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-5" /></button>
          <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("common.studio")}</p><h1 className="font-serif text-base font-semibold sm:text-xl">{t("dashboard.welcome")}</h1></div>
        </div>
        <Button onClick={onCreate} size="lg" className="shrink-0"><Plus className="size-4" /> <span className="hidden sm:inline">{t("dashboard.createFilm")}</span></Button>
      </header>

      <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-8 md:px-10">
        {checkoutBanner === "success" && <Card className="border-success/40 bg-success/5"><CardContent className="flex items-center justify-between gap-4 p-5 text-sm text-success"><span>{t("dashboard.checkoutSuccess")}</span><Button variant="outline" size="sm" onClick={() => setCheckoutBanner(null)}>{t("common.dismiss")}</Button></CardContent></Card>}
        {checkoutBanner === "cancelled" && <Card className="border-warning/40 bg-warning/10"><CardContent className="flex items-center justify-between gap-4 p-5 text-sm text-warning"><span>{t("dashboard.checkoutCancelled")}</span><Button variant="outline" size="sm" onClick={() => setCheckoutBanner(null)}>{t("common.dismiss")}</Button></CardContent></Card>}
        {error && <Card className="border-destructive/40 bg-destructive/5"><CardContent className="flex items-center justify-between gap-4 p-5 text-sm text-destructive"><span>{error}</span><Button variant="outline" size="sm" onClick={reload}>{t("common.retry")}</Button></CardContent></Card>}
        {data && data.issues.length > 0 && <Card className="border-warning/40 bg-warning/10"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5 text-sm text-warning"><div><p className="font-medium">{t("dashboard.issuesTitle", { count: data.issues.length })}</p><p className="mt-1 text-xs text-warning">{t("dashboard.issuesDetail")}</p></div><Button variant="outline" size="sm" onClick={onBrowseProjects}>{t("dashboard.reviewIssues", { count: data.issues.length })} <ArrowRight className="size-4" /></Button></CardContent></Card>}
        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          {loading && !data ? <DashboardHeroSkeleton /> : featured ? <Card className="relative min-h-[360px] overflow-hidden border-0 bg-[linear-gradient(135deg,#3a302b_0%,#7b5a42_52%,#c9a878_100%)] text-white shadow-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(255,255,255,.22),transparent_35%),linear-gradient(to_top,rgba(14,12,11,.78),transparent_65%)]" />
            <ProjectAvatar project={featured} className="absolute right-10 top-12 size-36 rounded-full border border-white/20 bg-white/10 backdrop-blur-sm" textClassName="text-5xl" />
            <div className="relative flex min-h-[360px] flex-col justify-end p-8">
              <Badge className="mb-4 w-fit border-0 bg-white/15 text-white">{t(statusLabelKey[featured.status])}</Badge>
              <h2 className="font-serif text-4xl font-semibold">{featured.name}</h2><p className="mt-1 text-white/75">{t(tierLabelKey[featured.tier] ?? "tier.template")} · {featured.currentPhase ? t(phaseLabelKey[featured.currentPhase]) : t("status.not_started")} · {t("dashboard.updatedAt", { date: formatDate(featured.updatedAt, locale) })}</p>
              <div className="mt-6 flex gap-3"><Button variant="secondary" onClick={() => onNavigate("assets", featured)}><FolderOpen className="size-4" /> {t("dashboard.openProject")}</Button></div>
            </div>
          </Card> : <Card className="grid min-h-[360px] place-items-center border-dashed"><CardContent className="text-center"><FolderOpen className="mx-auto size-10 text-muted-foreground" /><h2 className="mt-4 font-serif text-2xl font-semibold">{t("dashboard.noProjects")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("dashboard.noProjectsDetail")}</p><Button className="mt-5" onClick={onCreate}><Plus className="size-4" /> {t("dashboard.createFilm")}</Button></CardContent></Card>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Metric icon={FolderOpen} value={String(counts.total)} label={t("dashboard.metric.projects")} detail={t("dashboard.metric.projectsDetail")} />
            <Metric icon={Film} value={String(counts.running)} label={t("dashboard.metric.running")} detail={t("dashboard.metric.runningDetail")} />
            <Metric icon={Layers3} value={String(counts.paused)} label={t("dashboard.metric.paused")} detail={t("dashboard.metric.pausedDetail")} />
            <Metric icon={Check} value={String(counts.completed)} label={t("dashboard.metric.completed")} detail={t("dashboard.metric.completedDetail")} />
          </div>
        </div>

        {featured && <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">{t("dashboard.pipelineProgress")}</CardTitle><CardDescription>{featured.name} · {featured.currentPhase ? t(phaseLabelKey[featured.currentPhase]) : t("status.not_started")}</CardDescription></div><span className="font-serif text-3xl font-semibold text-primary">{featured.progress}%</span></CardHeader><CardContent><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${featured.progress}%` }} /></div><div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className={cn("size-2 rounded-full", statusDotClass[featured.status])} /> {t(statusLabelKey[featured.status])}</span><span>{featured.status === "running" ? t("dashboard.lastProgress") : t("dashboard.updated")} {formatDate(featured.updatedAt, locale)}</span></div>{featured.error && <p className="mt-3 text-xs text-destructive">{featured.error}</p>}</CardContent></Card>}

        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">{t("dashboard.recentProjects")}</CardTitle><CardDescription>{loading ? t("dashboard.loadingProjects") : t("dashboard.orderedByUpdate")}</CardDescription></div><Button variant="ghost" size="sm" onClick={onBrowseProjects}>{t("dashboard.viewAll")} <ArrowRight className="size-4" /></Button></CardHeader>{/* auto-fit (not a fixed 4) so one project fills the row instead of sitting
    in a quarter-width tile beside three empty tracks. */}
<CardContent className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">{projects.slice(0, 4).map((project, index) => <button onClick={() => onNavigate("assets", project)} key={project.id} className="overflow-hidden rounded-lg border bg-background text-left transition hover:border-primary/40 hover:shadow-sm"><ProjectAvatar project={project} className={cn("h-28 w-full", ["bg-[#8b7869]", "bg-[#65705f]", "bg-[#9b745d]", "bg-[#687a87]"][index])} textClassName="text-2xl" /><div className="p-3"><p className="text-sm font-medium">{project.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{t(tierLabelKey[project.tier] ?? "tier.template")} · {project.currentPhase ? t(phaseLabelKey[project.currentPhase]) : t("status.not_started")}</p><Badge className={cn("mt-3 border-0", statusClass[project.status])}>{t(statusLabelKey[project.status])}</Badge></div></button>)}{!loading && projects.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">{t("dashboard.noRecentProjects")}</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-primary" /> {t("dashboard.needsAttention")}</CardTitle><CardDescription>{t("dashboard.needsAttentionDetail")}</CardDescription></CardHeader><CardContent className="space-y-4 text-sm">{attentionItems.slice(0, 4).map((item) => <button onClick={item.onSelect} key={item.key} className="flex w-full gap-3 rounded-md text-left focus:outline-none focus:ring-2 focus:ring-ring"><span className={cn("mt-1 size-2 shrink-0 rounded-full", item.severe ? "bg-destructive" : "bg-warning")} /><span className="min-w-0 flex-1"><span className="block truncate">{item.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.detail}</span></span></button>)}{attentionItems.length > 4 && <p className="text-xs text-muted-foreground">{t("dashboard.andMore", { count: attentionItems.length - 4 })}</p>}{!loading && attentionItems.length === 0 && <div className="py-8 text-center"><Check className="mx-auto size-6 text-success" /><p className="mt-2 text-sm font-medium">{t("dashboard.allClear")}</p><p className="mt-1 text-xs text-muted-foreground">{t("dashboard.allClearDetail")}</p></div>}</CardContent></Card>
        </div>
      </div>
    </>
  )
}

type AttentionItem = { key: string; title: string; detail: string; severe: boolean; onSelect: () => void }

function DashboardHeroSkeleton() {
  const { t } = useI18n()
  return <Card aria-label={t("dashboard.loadingHero")} className="min-h-[360px] animate-pulse overflow-hidden border-0 bg-muted">
    <CardContent className="flex min-h-[360px] flex-col justify-end gap-4 p-8">
      <div className="h-6 w-24 rounded-full bg-background/70" />
      <div className="h-10 w-2/3 rounded bg-background/70" />
      <div className="h-4 w-1/2 rounded bg-background/70" />
      <div className="mt-2 h-10 w-36 rounded bg-background/70" />
    </CardContent>
  </Card>
}

// The representative photo for a finished project — same thumbnail.jpg the
// delivery package already picked (a real hero frame, never a bookend
// slide). Falls back to the letter-avatar placeholder for a project with no
// delivery yet (thumbnail 404s as ARTIFACT_NOT_READY, useApiObjectUrl just
// resolves null), so "not delivered" degrades gracefully instead of erroring.
function ProjectAvatar({ project, className, textClassName }: { project: ProjectSummary; className?: string; textClassName?: string }) {
  const thumbnailUrl = useApiObjectUrl(`/projects/${encodeURIComponent(project.id)}/artifacts/thumbnail`)
  return <div className={cn("overflow-hidden", className)}>
    {thumbnailUrl
      ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" />
      : <div className={cn("grid h-full w-full place-items-center font-serif text-white", textClassName)}>{initials(project.name)}</div>}
  </div>
}

// `detail` is a neutral description of what the number counts ("All project
// folders"), not a verdict — it used to be painted success-green, which read
// as "0 running is good news".
function Metric({ icon: Icon, value, label, detail }: { icon: typeof Film; value: string; label: string; detail: string }) {
  return <Card><CardContent className="p-5"><div className="grid size-9 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-4" /></div><p className="mt-5 font-serif text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p><p className="mt-3 text-xs text-muted-foreground/80">{detail}</p></CardContent></Card>
}
