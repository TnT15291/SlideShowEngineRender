import { useEffect, useState } from "react"
import { Menu, RefreshCw, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n } from "@/lib/i18n"
import type { StringKey } from "@/lib/strings"
import type { Incident, IncidentList } from "@/types"

const incidentStatusKey: Record<Incident["status"], StringKey> = {
  new: "admin.status.new",
  investigating: "admin.status.investigating",
  resolved: "admin.status.resolved",
}

export function AdminIncidentsPage({ onOpenNav }: { onOpenNav: () => void }) {
  const { t } = useI18n()
  const [data, setData] = useState<IncidentList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try { setData(await apiGet<IncidentList>("/admin/incidents")); setError(null) }
    catch (reason) { setError(apiMessage(reason, t)) }
    finally { setLoading(false) }
  }

  async function update(incident: Incident, status: Incident["status"]) {
    await apiPatch(`/admin/incidents/${encodeURIComponent(incident.id)}`, { status })
    await refresh()
  }

  async function retry(incident: Incident) {
    await apiPost(`/admin/incidents/${encodeURIComponent(incident.id)}/retry`, {})
    await refresh()
  }

  useEffect(() => { void refresh() }, [])

  return <>
    <header className="flex h-20 items-center gap-4 border-b px-4 md:px-10"><button aria-label={t("common.openNavigation")} onClick={onOpenNav} className="grid size-11 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-4" /></button><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("common.studio")}</p><h1 className="font-serif text-xl font-semibold">{t("admin.title")}</h1></div><Button variant="outline" size="sm" className="ml-auto" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> <span className="hidden sm:inline">{t("common.refresh")}</span></Button></header>
    <div className="mx-auto max-w-7xl px-6 py-8 md:px-10">
      <p className="text-sm text-muted-foreground">{t("admin.needAttention", { count: data?.openCount || 0 })}</p>
      {error && <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
      <div className="mt-6 space-y-4">{data?.incidents.map((incident) => <Card key={incident.id} className={incident.status === "new" ? "border-warning/40" : ""}>
        <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-warning" /> {incident.code}</CardTitle><CardDescription className="mt-1">{incident.id} · {incident.projectId} · {t("admin.phase", { phase: incident.phase })} · {t("admin.occurrences", { count: incident.occurrences })}</CardDescription></div><Badge variant="outline">{t(incidentStatusKey[incident.status])}</Badge></CardHeader>
        <CardContent><p className="text-sm">{incident.message}</p><p className="mt-2 text-xs text-muted-foreground">{t("admin.customerImpact", { impact: incident.customerImpact })}</p>{incident.technicalDetail && <details className="mt-4"><summary className="cursor-pointer text-xs font-medium">{t("admin.technicalDetail")}</summary><pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-[#201d1b] p-3 text-xs text-[#eee8df]">{incident.technicalDetail}</pre></details>}<div className="mt-5 flex gap-2">{incident.status === "new" && <Button size="sm" variant="outline" onClick={() => void update(incident, "investigating")}>{t("admin.investigate")}</Button>}{incident.status !== "resolved" && incident.code === "CONTACT_SHEET_GENERATION_FAILED" && <Button size="sm" variant="outline" onClick={() => void retry(incident)}>{t("admin.retryStep")}</Button>}{incident.status !== "resolved" && <Button size="sm" onClick={() => void update(incident, "resolved")}>{t("admin.markResolved")}</Button>}</div></CardContent>
      </Card>)}{!loading && data?.incidents.length === 0 && <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">{t("admin.empty")}</CardContent></Card>}</div>
    </div>
  </>
}
