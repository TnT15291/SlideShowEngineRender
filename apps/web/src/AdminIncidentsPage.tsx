import { useEffect, useState } from "react"
import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPatch, apiPost } from "@/lib/api"
import type { Incident, IncidentList } from "@/types"

export function AdminIncidentsPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<IncidentList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try { setData(await apiGet<IncidentList>("/admin/incidents")); setError(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
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

  return <main className="min-h-screen bg-background p-6 md:p-10">
    <div className="mx-auto max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><Button variant="outline" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button><div><h1 className="font-serif text-3xl font-semibold">Technical incidents</h1><p className="text-sm text-muted-foreground">{data?.openCount || 0} incident(s) need attention</p></div></div><Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /> Refresh</Button></div>
      {error && <p className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>}
      <div className="mt-8 space-y-4">{data?.incidents.map((incident) => <Card key={incident.id} className={incident.status === "new" ? "border-amber-300" : ""}>
        <CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-amber-600" /> {incident.code}</CardTitle><CardDescription className="mt-1">{incident.id} · {incident.projectId} · phase {incident.phase} · occurred {incident.occurrences} time(s)</CardDescription></div><Badge variant="outline" className="capitalize">{incident.status}</Badge></CardHeader>
        <CardContent><p className="text-sm">{incident.message}</p><p className="mt-2 text-xs text-muted-foreground">Customer impact: {incident.customerImpact}</p>{incident.technicalDetail && <details className="mt-4"><summary className="cursor-pointer text-xs font-medium">Technical detail</summary><pre className="mt-2 max-h-52 overflow-auto rounded-lg bg-[#201d1b] p-3 text-xs text-[#eee8df]">{incident.technicalDetail}</pre></details>}<div className="mt-5 flex gap-2">{incident.status === "new" && <Button size="sm" variant="outline" onClick={() => void update(incident, "investigating")}>Investigate</Button>}{incident.status !== "resolved" && incident.code === "CONTACT_SHEET_GENERATION_FAILED" && <Button size="sm" variant="outline" onClick={() => void retry(incident)}>Retry failed step</Button>}{incident.status !== "resolved" && <Button size="sm" onClick={() => void update(incident, "resolved")}>Mark resolved</Button>}</div></CardContent>
      </Card>)}{!loading && data?.incidents.length === 0 && <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">No technical incidents.</CardContent></Card>}</div>
    </div>
  </main>
}
