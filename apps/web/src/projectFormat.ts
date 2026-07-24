import type { ProjectStatus } from "@/types"

export const statusLabel: Record<ProjectStatus, string> = {
  not_started: "Not started",
  running: "Running",
  completed: "Completed",
  completed_with_warning: "Completed with warning",
  failed: "Failed",
  paused: "Paused",
  invalid: "Invalid data",
}

export const statusClass: Record<ProjectStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  completed_with_warning: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
  paused: "bg-amber-100 text-amber-800",
  invalid: "bg-red-100 text-red-800",
}

export function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export function initials(name: string) {
  return name.split(/\s*&\s*|\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ST"
}
