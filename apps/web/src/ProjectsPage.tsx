import { AlertTriangle, FolderOpen, Menu, RefreshCw, Square, Trash2, X } from "lucide-react"
import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useProjects } from "@/hooks/useProjects"
import { apiDelete, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { formatDate, phaseLabelKey, statusClass, statusLabelKey, tierLabelKey } from "@/projectFormat"
import type { ProjectSummary } from "@/types"

// Shared by the header row and every project row so the two can't drift apart.
// Below `xl` the rows stack and each value carries its own inline label instead.
const rowColumns = "xl:grid-cols-[minmax(220px,1.5fr)_90px_110px_140px_90px_minmax(150px,1fr)_auto]"

export function ProjectsPage({ onOpenNav, onOpen, title, description }: { onOpenNav: () => void; onOpen: (project: ProjectSummary) => void; title?: string; description?: string }) {
  const { t, locale } = useI18n()
  const { data, error, loading, reload } = useProjects()
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null)

  async function cancel(project: ProjectSummary) {
    setBusy(`cancel:${project.id}`)
    setActionError(null)
    try {
      await apiPost(`/projects/${project.id}/job/cancel`, {})
      await reload()
    } catch (reason) {
      setActionError(apiMessage(reason, t))
    } finally {
      setBusy(null)
    }
  }

  async function remove(project: ProjectSummary) {
    setBusy(`delete:${project.id}`)
    setActionError(null)
    try {
      await apiDelete(`/projects/${project.id}`)
      setPendingDelete(null)
      await reload()
    } catch (reason) {
      setActionError(apiMessage(reason, t))
    } finally {
      setBusy(null)
    }
  }

  return <>
    <header className="flex h-20 items-center gap-4 border-b px-4 md:px-10"><button aria-label={t("common.openNavigation")} onClick={onOpenNav} className="grid size-11 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-4" /></button><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("common.studio")}</p><h1 className="font-serif text-xl font-semibold">{title ?? t("projects.title")}</h1>{description && <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{description}</p>}</div><Button variant="outline" size="sm" className="ml-auto" onClick={reload}><RefreshCw className="size-4" /> <span className="hidden sm:inline">{t("common.refresh")}</span></Button></header>
    <div className="mx-auto max-w-[1440px] px-6 py-8 md:px-10">
      {error && <Card className="mb-5 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
      {actionError && <Card className="mb-5 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{actionError}</CardContent></Card>}
      {data && data.issues.length > 0 && <Card className="mb-5 border-warning/40 bg-warning/10"><CardContent className="p-5 text-sm text-warning">
        <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 shrink-0" /> {t("projects.issuesTitle", { count: data.issues.length })}</p>
        <ul className="mt-3 space-y-3">{data.issues.map((issue) => <li key={`${issue.projectId}-${issue.detail}`}>
          <p className="font-medium">{issue.projectId}</p>
          <p className="mt-0.5 text-xs leading-5">{issue.message}</p>
          <p className="mt-1 font-mono text-[11px] text-warning/80">{issue.detail}</p>
        </li>)}</ul>
      </CardContent></Card>}
      {loading && !data && <ProjectListSkeleton />}
      {!loading && data?.projects.length === 0 && <Card><CardContent className="grid min-h-64 place-items-center p-8 text-center"><div><FolderOpen className="mx-auto size-10 text-muted-foreground" /><h2 className="mt-4 font-serif text-xl font-semibold">{t("projects.empty")}</h2><p className="mt-2 text-sm text-muted-foreground">{t("projects.emptyDetail")}</p></div></CardContent></Card>}
      {data && data.projects.length > 0 && <div className="grid gap-4">
        <div className={cn("hidden gap-4 px-5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:grid xl:items-center", rowColumns)} aria-hidden="true">
          <span>{t("projects.column.project")}</span><span>{t("projects.column.tier")}</span><span>{t("projects.column.phase")}</span><span>{t("projects.column.status")}</span><span>{t("projects.column.progress")}</span><span>{t("projects.column.updated")}</span><span />
        </div>
        {data.projects.map((project) => <Card key={project.id}><CardContent className={cn("grid gap-4 p-5 xl:items-center", rowColumns)}>
          <button className="min-w-0 text-left" onClick={() => onOpen(project)}><p className="font-medium hover:text-primary">{project.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{project.id}{project.recipe ? ` · ${project.recipe}` : ""}</p>{project.error && <p className="mt-1 line-clamp-1 text-xs text-destructive">{project.error}</p>}{project.warnings?.map((warning, index) => <p key={`${warning.code}-${index}`} className="mt-1 line-clamp-1 text-xs text-warning"><AlertTriangle className="mr-1 inline size-3" />{warning.message}</p>)}</button>
          <ProjectDatum label={t("projects.column.tier")} value={t(tierLabelKey[project.tier] ?? "tier.template")} />
          <ProjectDatum label={t("projects.column.phase")} value={project.currentPhase ? t(phaseLabelKey[project.currentPhase]) : "—"} />
          <div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:hidden">{t("projects.column.status")}</p><Badge className={`${statusClass[project.status]} w-fit border-0`}>{t(statusLabelKey[project.status])}</Badge></div>
          <ProjectDatum label={t("projects.column.progress")} value={`${project.progress}%`} />
          <ProjectDatum label={t("projects.column.updated")} value={formatDate(project.updatedAt, locale)} compact />
          <div className="flex items-center gap-2 border-t pt-3 xl:border-0 xl:pt-0"><Button variant="outline" size="sm" onClick={() => onOpen(project)}>{t("common.open")}</Button>{project.status === "running" && <Button aria-label={t("projects.cancelJob", { name: project.name })} variant="outline" size="icon" disabled={busy !== null} onClick={() => void cancel(project)}><Square className="size-4" /></Button>}<Button aria-label={t("projects.deleteProject", { name: project.name })} variant="ghost" size="icon" className="ml-auto text-destructive hover:text-destructive xl:ml-0" disabled={busy !== null} onClick={() => setPendingDelete(project)}><Trash2 className="size-4" /></Button></div>
        </CardContent></Card>)}
      </div>}
    </div>
    {pendingDelete && <DeleteProjectDialog project={pendingDelete} busy={busy !== null} onCancel={() => setPendingDelete(null)} onConfirm={() => void remove(pendingDelete)} />}
  </>
}

function DeleteProjectDialog({ project, busy, onCancel, onConfirm }: { project: ProjectSummary; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n()
  const [confirmName, setConfirmName] = useState("")
  const matches = confirmName.trim() === project.name
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-4" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
    <div className="w-full max-w-md rounded-xl border bg-background p-6 text-foreground shadow-2xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"><AlertTriangle className="size-5" /></span>
          <div>
            <h2 id="delete-project-title" className="font-serif text-xl font-semibold">{t("projects.delete.title")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("projects.delete.warningBefore")}<strong className="font-medium text-foreground">{project.name}</strong>{t("projects.delete.warningAfter")}</p>
          </div>
        </div>
        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-muted" aria-label={t("common.cancel")} onClick={onCancel}><X className="size-4" /></button>
      </div>
      <label className="mt-5 block space-y-1.5 text-sm font-medium">
        {t("projects.delete.confirmBefore")}<span className="font-semibold">{project.name}</span>{t("projects.delete.confirmAfter")}
        <input autoFocus className="field w-full" value={confirmName} onChange={(event) => setConfirmName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && matches && !busy) onConfirm() }} />
      </label>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="button" variant="destructive" disabled={!matches || busy} onClick={onConfirm}><Trash2 className="size-4" /> {busy ? t("projects.delete.deleting") : t("projects.delete.title")}</Button>
      </div>
    </div>
  </div>
}

// No `capitalize` on the value: these are translated labels that already carry
// the right casing, and the CSS rule would title-case every Vietnamese word.
function ProjectDatum({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return <div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground xl:hidden">{label}</p><p className={compact ? "text-xs text-muted-foreground" : "text-sm"}>{value}</p></div>
}

function ProjectListSkeleton() {
  const { t } = useI18n()
  return <div aria-label={t("projects.loadingList")} className="grid animate-pulse gap-4">{[0, 1, 2].map((item) => <div key={item} className="h-24 rounded-xl bg-muted" />)}</div>
}
