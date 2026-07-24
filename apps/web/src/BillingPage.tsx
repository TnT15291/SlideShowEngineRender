import { useEffect, useState } from "react"
import { ArrowLeft, Check, Clapperboard, Crown, Film } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost, ApiError } from "@/lib/api"
import type { BillingCatalog } from "@/types"

function formatPrice(unitAmountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(unitAmountCents / 100)
  } catch {
    return `${(unitAmountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

export function BillingPage({ onBack }: { onBack: () => void }) {
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
  const [busy, setBusy] = useState<"subscription" | "per_video" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<BillingCatalog>("/billing/plans").catch((reason: unknown) => setError(messageOf(reason))).then((data) => { if (data) setCatalog(data) })
  }, [])

  async function checkout(plan: "subscription" | "per_video") {
    setBusy(plan)
    setError(null)
    try {
      const { url } = await apiPost<{ url: string }>("/billing/checkout", { plan })
      // Payment happens on Stripe's hosted page — leaving the app here is expected.
      window.location.href = url
    } catch (reason) {
      setError(messageOf(reason))
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="flex h-20 items-center gap-4 border-b px-6 md:px-10">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="size-4" /></Button>
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">StoReel</p>
            <h1 className="font-serif text-xl font-semibold">Upgrade</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10 md:px-10">
        {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
        {!catalog && !error && <p className="text-sm text-muted-foreground">Loading plans…</p>}
        {catalog && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Film className="size-5" /></div>
                <CardTitle className="mt-4">Pay per video</CardTitle>
                <CardDescription>{formatPrice(catalog.per_video.unitAmountCents, catalog.per_video.currency)} — one finished film, no recurring charge.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full" onClick={() => void checkout("per_video")} disabled={busy !== null}>
                  {busy === "per_video" ? "Redirecting…" : "Buy a video"}
                </Button>
              </CardContent>
            </Card>
            <Card className="border-primary/40">
              <CardHeader>
                <div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Crown className="size-5" /></div>
                <CardTitle className="mt-4">Monthly subscription</CardTitle>
                <CardDescription>{formatPrice(catalog.subscription.unitAmountCents, catalog.subscription.currency)}/month — up to {catalog.subscription.monthlyRenderQuota} renders, billed monthly.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" /> {catalog.subscription.monthlyRenderQuota} renders every billing period</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" /> Cancel any time</li>
                </ul>
                <Button className="w-full" onClick={() => void checkout("subscription")} disabled={busy !== null}>
                  {busy === "subscription" ? "Redirecting…" : "Subscribe"}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}

function messageOf(reason: unknown) {
  return reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : "Unable to load billing"
}
