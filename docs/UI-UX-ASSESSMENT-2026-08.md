# UI/UX assessment and remediation plan — round 2

Date: 2026-08-06
Status: **implemented 2026-08-07**, except two items called out under
"Deliberately not done" at the end of this document.
Surface: StoReel web studio (`apps/web`) + the API contract it renders
Method: full signed-out → register → intake → upload → render → failure walk
through of a real local stack (`server/index.ts` + Vite), plus computed-style
and contrast measurements taken on the live page. Written in English to sit
beside its predecessor, `UI-UX-ASSESSMENT.md` (2026-07-26).

## What changed since the last round

The 2026-07-26 plan has largely landed and held up under this walkthrough:
skeletons instead of empty-state flashes, a mobile step summary with a scroll
affordance, 44 px icon targets, cards below `xl` on Projects, recipe search /
mood filter / "most versatile" recommendation, disabled CTAs that name their
blocking reason, and the grouped Cull Advisor. Full `vi`/`en` i18n also landed,
which was not in that plan.

So this round is not a re-run. It is what the walkthrough surfaced *past* that
work, and it is dominated by one theme the previous round did not reach: **the
studio chrome is now good enough that its remaining defects are in the parts
the chrome cannot see** — a CSS layer conflict that silently deletes utility
classes, an API that hands one tenant another tenant's folder names, content
that was never translated, and a paid render that is charged before anything is
checked.

## Executive assessment

The product reads as a coherent, well-considered studio. The failure it has is
concentrated and expensive: **a customer can be charged a render credit for a
run that the app already knew could not succeed, and then be shown a Node.js
stack trace as the explanation.**

That was not hypothetical during this audit. The intake picker printed
"18–40 photos" for the chosen recipe. The Direct step printed it again. The
Media step accepted three photos without comment, the Create step started,
the credit balance went 3 → 2, and eleven seconds later the customer-facing
result was:

```
! Error: Global photo assignment could not fill: s01_save_the_date:strip_3
! 3 requests demand 3 photo(s); the pool has 3, of which 1 are reserved for
!   bookends — leaving 2. The shot list is over-drawn by 1.
! at file:///D:/Claude/Projects/SlideshowRenderEngine/scripts/applyStoryTemplate.mjs:752:9
! at ModuleJob.run (node:internal/modules/esm/module_job:430:25)
! Node.js v24.14.0
```

with the durable, refresh-surviving message being
`recipe: jmii-silk-botanical-01.json failed (exit 1)`.

Everything else in this document is smaller than that.

## P0 — Defects that break the job

### P0.1 `.field` sits outside Tailwind's cascade layers and silently kills every utility applied with it

`index.css:71–73` declares `.field` as plain, unlayered CSS. `@import
"tailwindcss"` puts all utilities in the `utilities` layer, and **unlayered CSS
beats any layered CSS regardless of specificity**. Every Tailwind class written
next to `.field` is therefore dead on arrival.

Measured on the live Recipe Library search box (`class="field mt-0 pl-9"`):

| Declared | Computed |
| --- | --- |
| `pl-9` → 36 px | `padding-left: 12px` |
| `mt-0` → 0 | `margin-top: 8px` |

Consequence: the placeholder and typed text start at x=308 while the search
icon's right edge is at x=324 — **text renders 16 px underneath the icon.**

Blast radius (every `.field` call site that pairs a utility):

- `RecipeLibrary.tsx:65` and `IntakeWizard.tsx:133` — `pl-9`, icon overlap
- `LoginPage.tsx:92,114` — `pr-10`, so a long password runs under the eye toggle
- `AnalysisPanel.tsx:82` — `w-28` on the keep-count input
- `TimelineViewer.tsx:101` — `h-8 min-w-0 flex-1 py-1 text-xs` on the slot select
- `ProjectsPage.tsx:105` — `w-full` on the delete-confirmation input

Fix: wrap the `.field` rules in `@layer components { … }`. One edit, no call
site changes. Then re-check the six sites above, because several were authored
*around* the broken behaviour and will shift once the utilities start applying.

Acceptance: `getComputedStyle` on `input.field.pl-9` reports `padding-left:
36px`; no text overlaps an adornment icon in any `.field` at 390 px and 1440 px.

### P0.2 Every `<select>` in the app looks exactly like a text input

`.field` sets `appearance: none` and there is no replacement indicator.
Measured: `appearance: "none"`, `background-image: "none"`, `padding-right:
12px`. There is no caret, no chevron, nothing.

On intake step 3 this produces two boxes reading "Share" and "Auto" that a
customer has no reason to believe are clickable. It also affects Video
language, both mood filters, the photo-count filter, and the timeline slot
picker.

Fix: add a `select.field` rule with an inline-SVG chevron background and
`padding-right: 2.25rem`. While there: "Quality" (draft/share/high/master) and
"Music mode" (auto/highlight/full_song) are unexplained jargon on a screen with
no helper text, unlike "Video language" one step earlier — give each a one-line
description.

### P0.3 The Analysis panel never refetches after an upload, and Refresh does not fix it

Reproduced: uploaded 3 photos + 1 track. The requirement row updated to
"3 photos added / 1 soundtrack added". The Analysis panel below it kept reading
`0 UPLOADED / 0 ANALYZED / 0 TRACKS` with **"Analyze photos & music" disabled**.
The workspace's own header Refresh did not change it. Only a full browser
reload did, after which the counter read `3 UPLOADED` and the button enabled.

Cause: `AnalysisPanel.tsx:23–31` — `reload` is a `useCallback` keyed on
`[project.id]`, and the only effect is `useEffect(reload, [reload])`. Nothing in
the component observes asset changes. `AssetsPage.tsx:210` passes `music` as a
prop but no reload key.

Fix: pass an asset revision key (e.g. `${photos.length}:${music.length}` or a
counter bumped by `reload`/`removeAsset`/`uploadOne`) and include it in the
effect deps. Same class of bug is worth checking on `TimelineViewer` and
`DirectorPanel`, which are also keyed on `project.id` alone.

Acceptance: uploading or deleting an asset updates the Analysis counters
without a page reload.

### P0.4 A render credit is consumed before anything is validated, and never returned

`server/app.ts:734` calls `consumeRenderEntitlement` unconditionally on
`POST /api/projects/:id/job`, before `startJob`. Observed: the balance went
3 → 2 for a run that failed in the **build** phase, before a single frame was
rendered. The failed state then offers "Try again", which charges again.

Fix, in order of preference:

1. Reserve on start, release on failure — smallest change, keeps the
   double-submit protection that charging-on-start gives you.
2. Or charge on first successful `render` phase completion.

Either way, add a precondition gate (P0.5) *before* the charge so the common
failure never reaches it.

Acceptance: a job that fails before `render` completes leaves the credit
balance unchanged; the change is covered by a test in
`server/services/auth.test.ts` or `jobs.test.ts`.

### P0.5 Nothing enforces the recipe's own photo range

The number is already on the client: `RecipeSummary.minPhotos` /
`idealPhotos` / `maxPhotos` (`types.ts:47–49`), already rendered by
`photoRange()` in the picker and the Direct step, and `AssetsPage` already
fetches the whole recipe at `AssetsPage.tsx:91–99`. It is simply never compared
against `assets.photos.length`.

Fix:

- Media step: turn the `Requirement` row from "Add at least one photo" into
  "18 of 40 photos — this style needs at least 18", with a warning (not a hard
  block) state between 1 and `minPhotos`.
- Server: reject the job with a typed `RECIPE_PHOTO_RANGE` error *before*
  `consumeRenderEntitlement`, so the CLI and any future client get the same
  guarantee.

Acceptance: with fewer than `minPhotos` photos the Media step says so by
number, and starting a render returns a typed error without charging.

### P0.6 Failures are reported as developer artefacts, and the explanation is lost on reload

Three separate problems stack here:

- The headline is "The pipeline needs attention" / "Check the error and live
  output, then run the pipeline again" — "pipeline" is internal vocabulary, and
  in the Vietnamese UI it is not even translated ("Pipeline cần được xử lý",
  "chạy lại pipeline", "nhật ký pipeline trực tiếp").
- The only real diagnosis is a Node stack trace with absolute developer paths,
  auto-expanded into the black console (`JobRunnerPanel.tsx:62`).
- Those log lines live only in `useState` (`JobRunnerPanel.tsx:31`), streamed
  over SSE. **Reload the page and they are gone**, leaving the customer with
  `recipe: jmii-silk-botanical-01.json failed (exit 1)`.

Fix:

- Map the handful of known engine failure signatures (photo pool over-drawn,
  music/playlist mismatch, missing ffmpeg, unreadable asset) to a
  customer-language cause + the action that resolves it. Everything unmapped
  falls back to today's text.
- Persist the last ~50 log lines into the job manifest so the console survives
  a reload; keep the raw trace behind the existing "Technical details"
  disclosure rather than in the headline.
- Strip the engine root from any path that reaches a customer surface.

## P1 — What the UI asserts that is not true or not theirs

### P1.1 One tenant sees every other tenant's unreadable folder names

`server/app.ts:393–395` filters `result.projects` by `ownerId` and passes
`result.issues` through untouched. `listProjects` (`projects.ts:139–200`) scans
the whole engine root.

Observed on a brand-new account with zero projects: the dashboard's first
element is "1 project folder can't be opened", the Needs-attention panel names
`inputs ảnh`, and the Projects page prints the raw server path
`projects/inputs ảnh/project.json — the file is missing`.

This is both the worst possible first-run impression and a small information
disclosure (folder names and server paths belonging to other data).

Fix: scope `issues` to folders whose manifest is readable *and* owned by the
session user; route genuinely unreadable folders to the admin incidents view
(`AdminIncidentsPage`), which is where an operator-facing filesystem problem
belongs. Never send a server path to a non-admin client.

Acceptance: a fresh account's dashboard and Projects page are clean; an
operator still learns about the broken folder.

### P1.2 Recipe content is Vietnamese-only inside a fully bilingual chrome

With the UI in English, the recipe picker, the Direct step and the Recipe
Library all render Vietnamese prose between English labels:

> **Silk Botanical Wedding** · 18–40 photos · 21 scenes · 13 looks
> *Phong cách save-the-date lụa ngà thanh lịch, dành cho bộ ảnh chân dung studio.*
> **Works best with:** *Cần bộ ảnh chân dung studio chất lượng cao…*

`moods` and `bestFor` are English lowercase slugs on the same card, so a single
card carries two languages and a third register. The story-arc chips are raw
engine identifiers title-cased — "Save The Date → Title → Bride → Groom →
Gallery → Meet → Signature → Story → Invitation → Moment → Together → Closing"
— of which "Title", "Signature", "Moment" and "Story" mean nothing to a couple.

Fix: give recipe JSON the same `{ vi, en }` shape `strings.ts` already uses for
`intro.summary` / `intro.photos` / `intro.story` / `intro.music` / `notes`,
falling back to `vi` when `en` is absent so nothing goes blank mid-migration.
Add a translated label map for arc beats and moods rather than
`humanizeTag()`-ing slugs.

### P1.3 Recipe names are the least legible thing on the card that exists to sell them

`RecipeSwatch` draws the name in white serif over `bg-gradient-to-t
from-black/70 via-black/10 to-transparent`. The name's baseline sits roughly
27 % up the swatch, i.e. against about `black/38` — and on the White Weddings
and Garden themes the underlying photo is near-white. "Garden Diary", "Silk
Botanical Wedding", "Studio White Pre-Wedding" and "Three Chapters" are all
hard to read at card size.

It matters more than it looks: `RecipeLibrary.tsx:88` marks `CardTitle`
`sr-only`, so **the swatch overlay is the only place the recipe name is drawn.**

Fix: replace the linear scrim with a solid-to-transparent band sized to the
text block (or sample the image's mean luminance behind the text region rather
than trusting `swatchPrefersLightInk`, which only sees the palette). Restore a
visible `CardTitle` under the swatch as a cheap belt-and-braces.

### P1.4 Projects list speaks in identifiers

The row shows `linh-nam-wedding-film · jmii-silk-botanical-…` and the truncated
`recipe: jmii-silk-botanical-01.json failed (exi…`, while the workspace one
click away resolves the same recipe to "Silk Botanical Wedding". Resolve the
name here too (or drop the slug line entirely) and show the mapped failure
cause from P0.6.

## P2 — Legibility, hierarchy, and flow

### P2.1 Three semantic colours fail AA at the sizes they are used

Measured on the live page against `--background` `oklch(0.973 0.011 79)`:

| Token | Ratio | Typical use | Verdict |
| --- | --- | --- | --- |
| `--foreground` | 16.33 | body | pass |
| `--muted-foreground` | 5.34 | secondary text | pass |
| `--warning` on `warning/10` fill | **4.42** | banner text, mostly `text-xs` | fail |
| `--primary` as text | **4.43** | `text-xs text-primary` links, fit reasons | fail |
| `--success` | **3.74** | `text-xs text-success` confirmations | fail |

All three are used predominantly at 11–12 px, where AA requires 4.5:1.

Fix: darken the three tokens by roughly 0.04–0.06 in oklch `L` **for text
use only** — introduce `--warning-text` / `--success-text` / `--primary-text`
and keep the current values for fills, icons and progress bars, so the visual
language does not change. `--primary-foreground` on `--primary` measures 4.66,
which passes but is worth nudging while the palette is open.

### P2.2 Step 4 runs three progress models at once, and repeats its own warning

On one screen: the 5-step workflow stepper, a "Step 4 of 5" badge restating it,
a 7-chip phase row (Checks/Media/Story/Edit/Video/Quality/Delivery), and a
5-row "Production files" list (Edit plan/Rendered film/Quality report/Preview/
Delivery master) that overlaps the phase row conceptually. The credit warning
also renders twice — the page-level banner and the in-card
`job.creditNeeded` block — with identical wording and an identical "View plans"
button.

Fix: drop the "Step N of 5" badge wherever the stepper is visible; fold
"Production files" into the phase row as per-phase artefacts, or label the two
lists so the difference is stated; render the credit warning once, at page
level.

### P2.3 `<details>` disclosures have no affordance

`AssetsPage.tsx:222` and the cull groups use `list-none` on `<summary>` with no
replacement chevron. Verified on the live page: the "Quality report" row is
visually indistinguishable from a static heading. Add a rotating chevron.

### P2.4 Intake step 2 is a ~4,000 px scroll with the exit at the bottom

25 recipe cards, `Continue` only after all of them, and the selected recipe's
"best fit" panel (`RecipeFit`) rendered *below all 25 cards* rather than beside
the card just clicked. Selecting the first card means scrolling ~3,000 px to
act on it.

Fix: make the intake footer bar sticky, and move `RecipeFit` into (or directly
under) the selected card. A "compare" affordance is optional; the sticky footer
is not.

### P2.5 Workspace step 1 is a screen nobody sees, and the intake stepper is not navigable

Creating a project lands on step 2 (`initialStep: "media"`). Step 1 "Setup" is a
read-only recap of the six fields the wizard just collected, ticked complete
before it is ever opened. Meanwhile the intake stepper items are `<li>` and
cannot be clicked to return to a completed step, while the workspace stepper
*can* — the same visual pattern behaves differently two screens apart.

Fix: either fold Setup into the Media step header as an editable summary and
run a 4-step workflow, or give it something to do (it is the natural home for
"change style / quality / music mode" after creation). Make completed intake
steps clickable.

### P2.6 Smaller items, grouped

- **Dashboard**: three buttons for one action in one viewport, under two labels
  — sidebar "New film", header "Create new film", empty-state "Create new
  film". Keep the sidebar one and the empty-state one; drop the header
  duplicate, or unify the label.
- **Media**: the copy promises "Upload order is preserved for chronological
  edits" but offers no reorder and no multi-select delete. At the 120–190
  photos "Classic Multisong Wedding Album" asks for, one-at-a-time deletion is
  not viable.
- **Register**: the rules (`[a-z0-9]+(?:-[a-z0-9]+)*`, min 3; password min 8)
  live only in `title` and native validation. State them under the fields.
- **Password field a11y**: the accessible name computes to "Password Show
  password" because the toggle `<button>` is inside the `<label>`. Move the
  button out of the label and pair them with `htmlFor`/`id`.
- **Login page has no `h1`** — the brand mark is a `CardTitle` (`h3`). Card
  headings inside sections also produce `h1 → h2 → h3 → h3` runs on the
  workspace.
- **Billing** shows prices but never the current plan, balance or renewal date,
  and states no policy for failed renders — which P0.4 makes load-bearing.
- **Vision upsell** renders on a Template project with zero photos, offering to
  "approve sending 0 photo previews to api.openai.com" and naming the model
  ("gpt-5.5"). Hide it for tiers that do not consume vision, and until there is
  at least one photo.
- **Two stacked sticky bars** (`h-20` header + step nav) hold ~145 px of a
  900 px laptop viewport permanently. Consider collapsing the header on scroll.

## Delivery order

1. **P0.1 + P0.2** — one `@layer components` wrap plus a `select.field` chevron.
   Highest ratio of visible repair to risk; do it first and re-verify the six
   call sites.
2. **P0.4 + P0.5** — precondition gate before the charge, then reserve/release.
   These ship together or the gate has no teeth.
3. **P0.3** — asset revision key into `AnalysisPanel`; audit the sibling panels.
4. **P1.1** — scope `issues` by owner, route the rest to admin incidents.
5. **P0.6** — failure-cause mapping + persisted log tail.
6. **P2.1** — text-only colour tokens.
7. **P1.2 + P1.3** — recipe content i18n and swatch legibility (largest content
   effort; independent of everything above).
8. **P2.2–P2.6** — hierarchy, affordances, and flow cleanups.
9. `npm run check` (typecheck, build, docs, api, unit, integration, audit) plus
   a repeat of this walkthrough on both locales at 390 px and 1440 px.

## Deliberately not done

Two items from P2.5 and P2.6 were left out. Both are product decisions rather
than defects, and guessing at them would have been worse than saying so.

**Restructuring workspace step 1 ("Setup").** The complaint stands — creating a
project lands on step 2, so Setup is a read-only recap that is ticked complete
before anyone opens it. But the two fixes on offer are a 5-step workflow
becoming a 4-step one, or Setup gaining the ability to change a project's
style / quality / music mode after creation. The first changes the shape of the
product; the second is a feature with server-side consequences (changing a
recipe after a render invalidates the timeline). Everything else in P2.5 —
navigable completed steps in the intake stepper — did ship.

**Photo reordering.** The Media step still promises "upload order is preserved
for chronological edits" and still offers no way to change that order.
Reordering needs an endpoint that rewrites `uploadIndex` across the asset set,
which does not exist. What did ship is the half that needed no new contract:
multi-select with a bulk delete, which is what makes a 140–220 photo album
manageable at all.

## What verification actually ran

- `npm run typecheck` (5/5), `npm run build`, `npm run docs:check`.
- `npm run test:unit` 432/432, `npm run test:api` 134/134 — up from 124,
  with new coverage for the precondition gate, the no-photos/no-music refusals,
  reservation reuse on resume, owner-scoped issues, and the failure-cause
  mapping and path redaction (the latter against the verbatim stderr from the
  run that started this document).
- The credit invariants were exercised against the real user store: a charge
  opens a hold, a running job settles nothing, a failure refunds exactly once
  and a second settle is a no-op, and a delivered film keeps the charge.
- A live re-walk in both locales at 390 px and 1440 px, confirming by computed
  style that `.field` now honours its utilities (`padding-left` 36 px, not 12),
  that every `<select>` draws a chevron, that the three text tokens clear
  4.5:1 on their own tinted fills (4.73 / 5.09 / 5.00), and that the exact
  3-photos-against-an-18-photo-recipe request now returns 409
  `RECIPE_PHOTO_RANGE` with the credit balance unchanged.

`npm run test:integration` fails on this tree with
`PRE-RENDER GATE FAILED: project[coverage_below_floor]`. That failure is **not
from this work**: it reproduces with every file touched here stashed, and it
comes from the uncommitted engine changes another session has in progress.

## Notes on method

Findings marked with measured values were taken from the running app via
`getComputedStyle` and a canvas-resolved WCAG contrast calculation, not read off
the source. The render failure, the credit decrement, the stale analysis panel
and the cross-tenant issue leak were each reproduced end to end on a fresh
`ux-audit` account against a real local API.
