# UI/UX assessment and remediation plan

Date: 2026-07-26  
Surface: StoReel web studio (`apps/web`)  
Status: implemented; thumbnail-backed Cull Advisor comparison remains a
follow-up requiring a dedicated authenticated preview contract

## Executive assessment

The visual language is coherent and the three-step intake is easy to follow.
The largest usability risk is not visual polish: project lifecycle state is
currently presented inconsistently. A user can see a completed job, 100%
progress, later workflow steps marked complete, and a blocked media CTA at the
same time. That breaks trust and obscures the next action.

## Findings and acceptance criteria

### P0 — Project state and calls to action

Observed:

- Dashboard can show `Not started`, `100%`, and `Completed` for one project.
- A dry run can mark later pipeline phases as skipped; the UI treats skipped as
  completion even though no preview or delivery exists.
- Media counts can be visible while the Continue action temporarily reports
  missing media during the initial asset request.

Root causes:

- Job completion and project delivery completion are represented by the same
  status.
- Progress counts skipped phases as completed and forces every completed job to
  100%.
- Workspace prerequisites render before asset data has loaded.

Acceptance:

- Delivered projects alone show `Completed` and 100%.
- A successful partial/dry run shows `Paused` with progress based only on
  completed phases and an actionable next step.
- Workflow checks use the same phase/asset rules as their CTA.
- No missing-media message or disabled CTA is shown until the asset request has
  resolved.
- A disabled CTA displays its blocking reason.

### P0 — Loading and empty states

Observed:

- Dashboard can flash `No projects yet` before projects load.
- Project-dependent tools initially show a mostly blank `Loading projects…`
  page.

Acceptance:

- Initial requests render skeletons, never empty states.
- Refresh retains the last successful data.
- Empty state renders only after a successful empty response.
- Errors preserve usable stale data and expose Retry.

### P1 — Project-aware navigation

Observed:

- Projects, Assets, and Timeline can each lead to the same project picker.
- Selecting a project opens a five-step workspace, but sidebar navigation loses
  the active project.

Acceptance:

- The last active project is retained for the signed-in browser session.
- Assets, AI Director, Timeline, and Render open the relevant workspace step
  directly when an active project exists.
- The URL continues to carry the project id for refresh/deep-link support.
- A project picker appears only when no valid active project is known.

### P1 — Media and Cull Advisor

Observed:

- Cull Advisor is a long list of technical filenames with no visual hierarchy.

Acceptance:

- Recommendations are grouped by reason (duplicates, blur/quality, exposure,
  and other).
- The default view shows group totals and a concise sample.
- Details are progressively disclosed.
- Each recommendation exposes a quality score where available.
- Source files are never deleted by applying a cull.

Photo thumbnails require a safe asset-preview endpoint and are tracked as a
follow-up; grouping and quality context ship first without weakening access
controls.

### P1 — Responsive and accessibility

Observed:

- Mobile workflow scroll has no affordance.
- Header text truncates aggressively.
- Several icon-only actions have no accessible name.
- Icon targets are 36×36 px.
- Projects table overflows at a common desktop width.
- Destructive actions are embedded inside a clickable project row.

Acceptance:

- Icon buttons have an accessible name and a minimum 44×44 px target.
- Workflow navigation shows a mobile step summary and a clear horizontal-scroll
  affordance.
- Projects become cards below the large desktop breakpoint; no forced
  1080-pixel table exists at 1150 pixels.
- Delete/cancel actions are separate from the project-opening control.

### P2 — Direction selection and copy

Observed:

- Recipe selection is a long nested scroll region without search/filter or a
  recommendation.
- English and Vietnamese labels are mixed.
- Disabled Continue does not explain the missing selection.
- Tier choice does not communicate time, credit, or output trade-offs.

Acceptance:

- Recipes support text search and mood filtering.
- A recommended recipe is identified from the available metadata.
- Continue names the missing requirement.
- Tier cards compare turnaround, credit usage, and creative depth.
- Intake interface copy uses one language consistently (English for the current
  studio UI); generated film language remains a project setting.

## Delivery order

1. Normalize lifecycle state, phase progress, workflow checks, and CTA reasons.
2. Correct loading/empty behavior.
3. Preserve active project context in navigation.
4. Restructure Cull Advisor.
5. Fix accessibility and responsive behavior.
6. Improve recipe discovery, tier comparison, and copy.
7. Run type checks, builds, API/unit tests, and focused regression tests.
