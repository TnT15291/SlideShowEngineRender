export type Plan =
  | { type: "subscription"; monthlyRenderQuota: number; rendersUsedThisPeriod: number; periodStart: string }
  | { type: "per_video"; creditsRemaining: number }

export interface StudioUser {
  id: string
  username: string
  plan: Plan
}

export interface Incident {
  id: string
  code: string
  projectId: string
  userId: string | null
  phase: string
  status: "new" | "investigating" | "resolved"
  message: string
  technicalDetail: string | null
  customerImpact: string
  occurrences: number
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

export interface IncidentList {
  incidents: Incident[]
  openCount: number
}

export interface BillingCatalog {
  subscription: { name: string; unitAmountCents: number; monthlyRenderQuota: number; currency: string }
  per_video: { name: string; unitAmountCents: number; credits: number; currency: string }
}

export interface RecipeSummary {
  id: string
  name: string
  libraryTheme: string | null
  themeBackground: string | null
  themeAccent: string | null
  bestFor: string[]
  minPhotos: number | null
  idealPhotos: number | null
  maxPhotos: number | null
  moods: string[]
  energy: string | null
  storyArc: string[]
  palette: Record<string, string>
  fonts: Record<string, string>
  sceneCount: number
  lookCount: number
  pacingVariants: string[]
  notes: string
}

export type ProjectStatus = "not_started" | "running" | "completed" | "completed_with_warning" | "failed" | "paused" | "invalid"

export interface ProjectSummary {
  id: string
  name: string
  tier: "template" | "lite" | "premium" | "unknown"
  recipe: string | null
  quality: "draft" | "share" | "high" | "master"
  language: "vi" | "en" | null
  sequenceMode: "editorial" | "chronological" | null
  status: ProjectStatus
  currentPhase: "validate" | "analyze" | "plan" | "build" | "render" | "qa" | "deliver" | null
  progress: number
  updatedAt: string
  createdAt: string | null
  error: string | null
  warnings?: Array<{ code: string; message: string }>
  phases: Record<string, "pending" | "running" | "completed" | "failed" | "skipped">
  shared: boolean
}

export interface ProjectListResponse {
  projects: ProjectSummary[]
  issues: Array<{ projectId: string; message: string }>
}

export interface CreateProjectInput {
  name: string
  bride: string
  groom: string
  language: "vi" | "en"
  sequenceMode: "editorial" | "chronological"
  tier: "template" | "lite" | "premium"
  recipe?: string
  quality: "draft" | "share" | "high" | "master"
  musicMode: "auto" | "highlight" | "full_song"
  creativeBrief: string
}

export type AssetKind = "photo" | "music"

export interface ProjectAsset {
  id: string
  kind: AssetKind
  originalName: string
  storedName: string
  uploadIndex: number
  mimeType: string
  size: number
  uploadedAt: string
}

export interface ProjectAssets {
  photos: ProjectAsset[]
  music: ProjectAsset[]
  limits: { photoMaxBytes: number; musicMaxBytes: number }
}

export type JobStatus = "not_started" | "pending" | "running" | "paused" | "failed" | "completed" | "completed_with_warning"

export interface JobSnapshot {
  projectId: string
  status: JobStatus
  currentPhase: "validate" | "analyze" | "plan" | "build" | "render" | "qa" | "deliver" | null
  progress: number
  error: string | null
  warnings?: Array<{ code: string; message: string }>
  startedAt: string | null
  updatedAt: string
  mode: "dry_run" | "render" | null
  deliver: boolean | null
  phases: Record<string, "pending" | "running" | "completed" | "failed" | "skipped">
}

export interface ProjectArtifact {
  id: "timeline" | "render" | "qa-report" | "preview" | "delivery" | "thumbnail" | "summary"
  label: string
  kind: "video" | "image" | "json"
  mimeType: string
  ready: boolean
  stale: boolean
  size: number | null
  updatedAt: string | null
  url: string
}

export interface TimelineImageSlot {
  id: string
  label: string
  path: string
  url: string | null
}

export interface TimelineScene {
  id: string
  index: number
  start: number
  end: number
  duration: number
  effect: string
  renderer: string
  layout: string | null
  transition: { type: string; duration: number }
  captions: string[]
  images: TimelineImageSlot[]
}

export interface TimelineSnapshot {
  projectId: string
  ready: boolean
  path: string
  project: { name: string; width: number; height: number; fps: number } | null
  totalDuration: number
  scenes: TimelineScene[]
  renderUrl: string | null
  updatedAt: string | null
}

export interface RevisionDirective {
  id: string
  round: number
  quote: string
  kind: string
  op: string
  target: unknown
  supersededBy?: number
  undoneBy?: number
}

export interface RevisionSnapshot {
  projectId: string
  maxRounds: number
  usedRounds: number
  remainingRounds: number
  nextRound: number
  rounds: Array<{ round: number; status: "active" | "superseded" | "undone"; directives: RevisionDirective[]; undoable: boolean }>
}

export interface RevisionResult {
  round: number | null
  blastRadius: "timeline" | "build" | "plan" | null
  requiresRestory: boolean
  destructive: boolean
  output: string
  snapshot: RevisionSnapshot
}

export interface StoryDirection {
  id: "A" | "B" | "C" | "D"
  title: string
  mood: string
  pacing: "slow" | "medium" | "fast" | "dynamic"
  emotionalArc: string
  summary: string
  captionTone?: string
  fitReason?: string
}

export interface DirectorState {
  projectId: string
  tier: "lite" | "premium"
  brief: string
  ready: boolean
  liteStory: null | { title?: string; generatedBy?: string; beats?: Array<{ heading: string; body: string; emotion: string; sceneKind: string }> }
  storyOptions: null | { generatedBy?: string; recommended: "A" | "B" | "C" | "D"; options: StoryDirection[] }
  selectedStory: null | { choice: "A" | "B" | "C" | "D"; source: "user" | "auto"; selected: StoryDirection; decisionWindow: { openedAt: string; deadlineAt: string; timeoutHours: number } }
  storyWindow: null | { status: "open" | "closed"; openedAt: string; deadlineAt: string; timeoutHours: number }
  selectedMusic: null | { mode: "highlight" | "full_song" | "auto"; source: string; reason: string; sourceDuration: number; preview?: { start: number; end: number; duration: number } }
  musicWindow: null | { status: "open" | "closed"; deadlineAt: string }
  directorNotes: null | { generatedBy?: string; storyTitle?: string; creative_brief?: Record<string, string>; director_notes?: Record<string, unknown> }
  storyPlan: null | { generatedBy?: string; segments?: Array<{ segment: string; goal: string; emotion: string; pacing: string; emphasis: string; photoTags: string[]; priorityEffect: string; captionIdea: string }> }
}

export interface QaProblem {
  id: string
  check: string
  flags: string[]
  detail?: string
}

export interface QaSnapshot {
  projectId: string
  ready: boolean
  status: "not_started" | "waiting" | "running" | "completed" | "failed"
  stage: "preflight" | "render" | "revising" | "manual_review" | "complete" | null
  verdict: "ok" | "review" | "unknown" | null
  preflightPasses: number
  preflightFixes: number
  preflightCapped: boolean
  revisions: number
  maxRevisions: number
  manualReview: string[]
  journal: string[]
  proxyProblems: QaProblem[]
  clipProblems: QaProblem[]
  visionReason: string | null
  updatedAt: string | null
  error: string | null
}

export interface DeliverySummary {
  project?: string
  generatedAt?: string
  tier?: "director" | "template" | "lite" | "unknown"
  provenance?: { photoContent?: string; artifacts?: string[]; note?: string }
  video?: { durationSec?: number; width?: number; height?: number; fps?: number; sizeBytes?: number }
  content?: { slides?: number; photosUsed?: number; uniquePhotos?: number; captions?: number }
  qa?: { verdict?: "ok" | "review" | "unknown"; problems?: number; reason?: string; manualReview?: boolean }
  thumbnail?: { chosenBy?: "explicit" | "heroScore" | "longest-hero-slide" | "midpoint"; reason?: string; timeSec?: number }
  preview?: { watermark?: string; durationSec?: number; width?: number; height?: number; sizeBytes?: number }
  deliverables?: Array<{ name: string; path: string; sizeBytes: number }>
}

export interface DeliverySnapshot {
  projectId: string
  artifacts: ProjectArtifact[]
  summary: DeliverySummary | null
  approval: { status: "none" | "approved" | "invalidated"; approvedAt: string | null; reason: string | null }
  release: { releasedAt: string } | null
}

export interface CullSuggestion {
  generatedAt: string
  keep: number
  sourceCount: number
  shortfall?: number
  note?: string
  drop: Array<{ file: string; reason: string; qualityNorm?: number | null; duplicateGroup?: string }>
  locked: Array<{ file: string; reason: string }>
}

export interface AnalysisSnapshot {
  projectId: string
  run: null | {
    status: "running" | "completed" | "failed"
    kind: "technical" | "vision"
    startedAt: string
    updatedAt: string
    error: string | null
    probeErrors: string[]
    logs: string[]
  }
  photos: { uploaded: number; technical: number; semantic: number; generatedBy: string | null }
  music: Array<{ file: string; status: "pending" | "completed" | "invalid"; duration: number | null; bpm: number | null; error: string | null }>
  vision: {
    model: string
    provider: string
    configured: boolean
    photoCount: number
    requests: number
    imageInputTokens: number | null
    estimatedUsd: { low: number; high: number } | null
    pricingNote: string
  }
  cull: CullSuggestion | null
  appliedCull: { appliedAt: string; keep: number; sourceCount: number } | null
}
