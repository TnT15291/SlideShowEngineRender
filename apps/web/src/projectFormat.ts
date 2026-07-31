import { intlLocales, type Locale } from "@/lib/i18n"
import type { StringKey } from "@/lib/strings"
import type { JobStatus, ProjectArtifact, ProjectStatus } from "@/types"

export type PhaseName = "validate" | "analyze" | "plan" | "build" | "render" | "qa" | "deliver"

/**
 * Status and phase names reach the UI as engine identifiers, so the label a
 * customer reads is looked up here rather than printed raw — that is how a
 * pipeline phase called `qa` used to surface as "Qa".
 */
export const statusLabelKey: Record<ProjectStatus, StringKey> = {
  not_started: "status.not_started",
  running: "status.running",
  completed: "status.completed",
  completed_with_warning: "status.completed_with_warning",
  failed: "status.failed",
  paused: "status.paused",
  invalid: "status.invalid",
}

// Jobs have a "pending" state projects never report, and never report the
// "invalid" one, so the two status vocabularies stay separate maps.
export const jobStatusLabelKey: Record<JobStatus, StringKey> = {
  not_started: "status.not_started",
  pending: "status.pending",
  running: "status.running",
  paused: "status.paused",
  failed: "status.failed",
  completed: "status.completed",
  completed_with_warning: "status.completed_with_warning",
}

export const phaseLabelKey: Record<PhaseName, StringKey> = {
  validate: "phase.validate",
  analyze: "phase.analyze",
  plan: "phase.plan",
  build: "phase.build",
  render: "phase.render",
  qa: "phase.qa",
  deliver: "phase.deliver",
}

export const phaseLongLabelKey: Record<PhaseName, StringKey> = {
  validate: "phaseLong.validate",
  analyze: "phaseLong.analyze",
  plan: "phaseLong.plan",
  build: "phaseLong.build",
  render: "phaseLong.render",
  qa: "phaseLong.qa",
  deliver: "phaseLong.deliver",
}

export const tierLabelKey: Record<string, StringKey> = {
  template: "tier.template",
  lite: "tier.lite",
  premium: "tier.premium",
}

export const qualityLabelKey: Record<string, StringKey> = {
  draft: "quality.draft",
  share: "quality.share",
  high: "quality.high",
  master: "quality.master",
}

export const sequenceLabelKey: Record<string, StringKey> = {
  editorial: "sequence.editorial",
  chronological: "sequence.chronological",
}

export const musicModeLabelKey: Record<string, StringKey> = {
  auto: "musicMode.auto",
  highlight: "musicMode.highlight",
  full_song: "musicMode.full_song",
}

// The server sends an English `label` with every artifact; the id is the
// language-neutral half of that pair, so the UI names them from here instead.
export const artifactLabelKey: Record<ProjectArtifact["id"], StringKey> = {
  timeline: "artifact.timeline",
  render: "artifact.render",
  "qa-report": "artifact.qa-report",
  preview: "artifact.preview",
  delivery: "artifact.delivery",
  thumbnail: "artifact.thumbnail",
  summary: "artifact.summary",
}

export const languageLabelKey: Record<string, StringKey> = {
  vi: "lang.vi",
  en: "lang.en",
}

export const statusClass: Record<ProjectStatus, string> = {
  not_started: "bg-muted text-muted-foreground",
  running: "bg-info/15 text-info",
  completed: "bg-success/15 text-success",
  completed_with_warning: "bg-warning/15 text-warning",
  failed: "bg-destructive/15 text-destructive",
  paused: "bg-warning/15 text-warning",
  invalid: "bg-destructive/15 text-destructive",
}

// The dot beside a status line. Derived per status rather than by a
// failed/paused/else ternary, which painted every remaining status green —
// so a project that had not been started yet reported success.
export const statusDotClass: Record<ProjectStatus, string> = {
  not_started: "bg-muted-foreground/40",
  running: "bg-info",
  completed: "bg-success",
  completed_with_warning: "bg-warning",
  failed: "bg-destructive",
  paused: "bg-warning",
  invalid: "bg-destructive",
}

export function formatDate(value: string, locale: Locale) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(intlLocales[locale], { dateStyle: "medium", timeStyle: "short" }).format(date)
}

export function initials(name: string) {
  // Couples are often named "Bride - Groom" (a bare hyphen, not just "&") —
  // without also splitting on it, "Vân - Tiến" reads the hyphen as its own
  // word and produces "V-" instead of "VT".
  return name.split(/\s*&\s*|\s+-\s+|\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "ST"
}
