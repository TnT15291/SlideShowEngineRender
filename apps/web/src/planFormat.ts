import type { Plan } from "@/types"

export function planIsExhausted(plan: Plan): boolean {
  return plan.type === "per_video" ? plan.creditsRemaining <= 0 : plan.rendersUsedThisPeriod >= plan.monthlyRenderQuota
}

export function planExhaustedReason(plan: Plan): string {
  return plan.type === "per_video"
    ? "No render credits remain on this account."
    : "The monthly render quota has been used."
}
