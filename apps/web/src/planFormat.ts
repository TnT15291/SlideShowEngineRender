import type { Translate } from "@/lib/i18n"
import type { Plan } from "@/types"

export function planSummary(plan: Plan, t: Translate): string {
  if (plan.type === "per_video") return t("plan.creditsLeft", { count: plan.creditsRemaining })
  return t("plan.quotaUsed", { used: plan.rendersUsedThisPeriod, quota: plan.monthlyRenderQuota })
}

/**
 * Mirrors the server's entitlement check in `consumeRenderEntitlement`. The
 * server is still the authority — this only exists so the UI can say "you need
 * credits" before the customer uploads a hundred photos and presses Create,
 * instead of surfacing a 402 at the very end of the workflow.
 */
export function planIsExhausted(plan: Plan): boolean {
  return plan.type === "per_video" ? plan.creditsRemaining <= 0 : plan.rendersUsedThisPeriod >= plan.monthlyRenderQuota
}

export function planExhaustedReason(plan: Plan, t: Translate): string {
  return t(plan.type === "per_video" ? "plan.noCredits" : "plan.quotaExhausted")
}
