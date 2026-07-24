import { AlertTriangle, ArrowLeft, FolderOpen, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useProjects } from "@/hooks/useProjects"
import { formatDate, statusClass, statusLabel } from "@/projectFormat"
import type { ProjectSummary } from "@/types"

export function ProjectsPage({ onBack, onOpen }: { onBack: () => void; onOpen: (project: ProjectSummary) => void }) {
  const { data, error, loading, reload } = useProjects()
  return <main className="min-h-screen bg-background text-foreground">
    <header className="flex h-20 items-center gap-4 border-b px-6 md:px-10"><Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Studio</p><h1 className="font-serif text-xl font-semibold">Projects</h1></div><Button variant="outline" size="sm" className="ml-auto" onClick={reload}><RefreshCw className="size-4" /> Refresh</Button></header>
    <div className="mx-auto max-w-[1440px] px-6 py-8 md:px-10">
      {error && <Card className="mb-5 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
      {data && data.issues.length > 0 && <Card className="mb-5 border-amber-300 bg-amber-50"><CardContent className="p-5 text-sm text-amber-900"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" /> {data.issues.length} project data issue(s)</p>{data.issues.map((issue) => <p key={`${issue.projectId}-${issue.message}`} className="mt-2 text-xs">{issue.projectId}: {issue.message}</p>)}</CardContent></Card>}
      {loading && <p className="text-sm text-muted-foreground">Loading projects…</p>}
      {!loading && data?.projects.length === 0 && <Card><CardContent className="grid min-h-64 place-items-center p-8 text-center"><div><FolderOpen className="mx-auto size-10 text-muted-foreground" /><h2 className="mt-4 font-serif text-xl font-semibold">No projects yet</h2><p className="mt-2 text-sm text-muted-foreground">Create a film to start the first project workspace.</p></div></CardContent></Card>}
      {data && data.projects.length > 0 && <div className="overflow-x-auto rounded-xl border bg-card"><div className="min-w-[950px]"><div className="grid grid-cols-[minmax(200px,1.6fr)_100px_130px_130px_90px_minmax(170px,1fr)] gap-4 border-b bg-card-soft px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Project</span><span>Tier</span><span>Phase</span><span>Status</span><span>Progress</span><span>Updated</span></div>{data.projects.map((project) => <button key={project.id} onClick={() => onOpen(project)} className="grid w-full grid-cols-[minmax(200px,1.6fr)_100px_130px_130px_90px_minmax(170px,1fr)] items-center gap-4 border-b px-5 py-4 text-left text-sm transition-colors last:border-0 hover:bg-card-soft"><div><p className="font-medium">{project.name}</p><p className="mt-1 text-xs text-muted-foreground">{project.id}{project.recipe ? ` · ${project.recipe}` : ""}</p>{project.error && <p className="mt-1 line-clamp-1 text-xs text-destructive">{project.error}</p>}</div><span className="capitalize">{project.tier}</span><span className="capitalize text-muted-foreground">{project.currentPhase || "—"}</span><Badge className={`${statusClass[project.status]} w-fit border-0`}>{statusLabel[project.status]}</Badge><span>{project.progress}%</span><span className="text-xs text-muted-foreground">{formatDate(project.updatedAt)}</span></button>)}</div></div>}
    </div>
  </main>
}
