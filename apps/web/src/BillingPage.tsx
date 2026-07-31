import { useEffect, useState } from "react"
import { Check, Clapperboard, Crown, Film, Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { intlLocales, useI18n, type Locale } from "@/lib/i18n"
import type { BillingCatalog } from "@/types"

function formatPrice(unitAmountCents: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(intlLocales[locale], { style: "currency", currency: currency.toUpperCase() }).format(unitAmountCents / 100)
  } catch {
    return `${(unitAmountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

// The card price is quoted in USD but MoMo charges VND, and most of this
// product's customers pay in VND — showing only the dollar figure left them to
// guess what the wallet would actually take. Grouping stays vi-VN in both
// languages because the amount itself is a Vietnamese-đồng figure.
function formatVnd(amount: number): string {
  return `${new Intl.NumberFormat("vi-VN").format(amount)} ₫`
}

export function BillingPage({ onOpenNav }: { onOpenNav: () => void }) {
  const { t, locale } = useI18n()
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null)
  const [busy, setBusy] = useState<"stripe_subscription" | "stripe_per_video" | "momo_per_video" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<BillingCatalog>("/billing/plans").catch((reason: unknown) => setError(apiMessage(reason, t, "billing.loadFailed"))).then((data) => { if (data) setCatalog(data) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkout(plan: "subscription" | "per_video", provider: "stripe" | "momo") {
    const key = `${provider}_${plan}` as typeof busy
    setBusy(key)
    setError(null)
    try {
      const { url } = await apiPost<{ url: string }>("/billing/checkout", { plan, provider })
      // Payment happens on Stripe's hosted page — leaving the app here is expected.
      window.location.href = url
    } catch (reason) {
      setError(apiMessage(reason, t, "billing.loadFailed"))
      setBusy(null)
    }
  }

  return (
    <>
      <header className="flex h-20 items-center gap-4 border-b px-6 md:px-10">
        <button aria-label={t("common.openNavigation")} onClick={onOpenNav} className="grid size-11 shrink-0 place-items-center rounded-md border lg:hidden"><Menu className="size-4" /></button>
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground"><Clapperboard className="size-4" /></div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("common.studio")}</p>
            <h1 className="font-serif text-xl font-semibold">{t("billing.title")}</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10 md:px-10">
        {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}
        {!catalog && !error && <p className="text-sm text-muted-foreground">{t("billing.loading")}</p>}
        {catalog && (
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Film className="size-5" /></div>
                <CardTitle className="mt-4">{t("billing.perVideo")}</CardTitle>
                <CardDescription>
                  {formatPrice(catalog.per_video.unitAmountCents, catalog.per_video.currency, locale)}
                  {catalog.momo.enabled && <> · {formatVnd(catalog.momo.perVideoAmountVnd)}</>}
                  {" "}{t("billing.perVideoDetail")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" onClick={() => void checkout("per_video", "stripe")} disabled={busy !== null}>
                  {busy === "stripe_per_video" ? t("billing.redirecting") : t("billing.payByCard")}
                </Button>
                {/* A payment method the server can't actually process is not an
                    option — it used to render as a permanently dead button
                    reading "MoMo is not configured", which tells a customer
                    nothing they can act on. */}
                {catalog.momo.enabled && <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => void checkout("per_video", "momo")}
                  disabled={busy !== null}
                >
                  {busy === "momo_per_video" ? t("billing.openingMomo") : t("billing.payWithMomo", { amount: formatVnd(catalog.momo.perVideoAmountVnd) })}
                </Button>}
              </CardContent>
            </Card>
            <Card className="border-primary/40">
              <CardHeader>
                <div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Crown className="size-5" /></div>
                <CardTitle className="mt-4">{t("billing.subscription")}</CardTitle>
                <CardDescription>{t("billing.subscriptionDetail", { price: formatPrice(catalog.subscription.unitAmountCents, catalog.subscription.currency, locale), quota: catalog.subscription.monthlyRenderQuota })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" /> {t("billing.rendersPerPeriod", { quota: catalog.subscription.monthlyRenderQuota })}</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" /> {t("billing.cancelAnyTime")}</li>
                </ul>
                <Button className="w-full" onClick={() => void checkout("subscription", "stripe")} disabled={busy !== null}>
                  {busy === "stripe_subscription" ? t("billing.redirecting") : t("billing.subscribe")}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  )
}
