# Timeline Generation Guide (AI Director Brief)

This is the prompt/spec for any AI that generates a `timeline.json` for the render
engine. It turns raw input (photos + story + music + theme) into a rich, emotional,
**valid** slideshow — as detailed as `timeline/white-weddings-theme-first-5.master.json`
— every time, without hand-computing pixels.

**Philosophy (see `docs/README.md`):** `AI → Decision · JSON → Contract ·
Engine → Execution · FFmpeg → Rendering`. You are the Director. You never write FFmpeg
and you never invent coordinates — you choose layouts, sequence beats, write copy, and
pace to the music. Geometry comes from `layouts/library.json`; the shape of your output
is fixed by `schema/timeline.schema.json`.

---

## 1. What you receive

- **Photos**: `input/*.jpg|png`, in order. Each has an aspect ratio; treat tall images
  as portraits (place in portrait slots), wide as landscapes. Prefer the sharpest /
  most expressive frames for hero and full-bleed slots.
- **Story / script**: free text or `heading | line` per row (see `docs/quoc-nhi-input-story.txt`).
- **Music**: one or more tracks, with a total duration and — if provided — a tempo/energy
  profile. If not provided, infer mood from the story and pick a tempo band yourself.
- **Theme**: one of `layouts/library.json → designTokens.themes` (default `white_weddings`).

## 2. Method (produce a beat sheet first, JSON second)

1. **Analyze** the story into **narrative beats**: opener → how-they-met → journey →
   milestones → the big day → closing. Each beat gets: a heading, 1 body line (Vietnamese
   OK), a photo count, and an emotional weight (calm / warm / upbeat / peak / tender).
2. **Fit to music**: total scene time ≈ music length. Put `montageBeats` (film_roll /
   collage) on musical **builds**; hold **hero_or_emotional** layouts on the **calm** and
   **peak** moments; end on a **closing_hold**.
3. **Assign a layout** to each beat from `layouts/library.json`. Alternate mirrors
   (`text_left_photo_right` ↔ `photo_left_text_right`) so no two neighbours look the same.
   Never reuse the same layout more than twice in a row.
4. **Fill the slots**: drop photos into `photoSlots` (respect portrait vs landscape),
   copy into `textSlots`, keep decor optional. Copy the slot's x/y/width/height verbatim
   into layer coordinates. Override `suggestedAnimation` only for a reason (see §4).
5. **Pace & emote** each scene (duration, transition, motion, grade) per §4, then **emit
   JSON** conforming to the schema.

## 3. Hard rules (the engine rejects violations — obey exactly)

- `slides[].duration`: **2 ≤ d ≤ 30** seconds. Vary it per beat; never a constant block.
- `transition.duration`: **0 ≤ t ≤ 2** AND **t < that slide's duration**. Applies into the
  NEXT slide. Last slide → `{ "type": "none", "duration": 0 }`.
- `effect: "layer_scene"` **requires** a non-empty `layers` array. Draw **back-to-front**:
  background/`rect` first, photos next, text last.
- Multi-image effects need `images`: `film_roll_*`/`collage_grid`/`double_exposure` ≥ 2;
  `memory_wall` 1–5. `video_background` needs `background`. Single-photo effects need `image`.
- **Text wrapping**: set `"wrap": true` on a text layer and the engine auto-wraps it to
  the slot width at compile time — no manual `\n` needed (explicit `\n` are still kept).
  Prefer `wrap: true` for all body copy. Rough budget if you wrap by hand:
  `slotWidth / (size × 0.5)` chars per line.
- `easing` on a slide is only legal on zoom/pan/kenburns effects (`slow_zoom_*`,
  `pan_*`, `kenburns_*`) — the engine rejects it on any other effect.
- An overlay sets **either** `path` **or** `variant` (bundled light leak), never both.
- **Vietnamese diacritics** → only `body` (BeVietnamPro) or `heading` (PlayfairDisplay).
  Script fonts (GreatVibes, etc.) are Latin-only — use them for `the`, `save`, romanized
  names, never for Vietnamese sentences.
- Photo frames use `fit: "cover"`. Keep content inside the 70px safe margin unless a photo
  is deliberately bled off-frame (negative x/y, as in `text_left_photo_right`).
- Every `id` unique. Every `path` must exist. `layer.start + duration ≤ slide.duration`.

## 4. Emotion & pacing playbook

- **Duration by weight** (`designTokens.pacing`): quick montage 2.5–3.5s · standard
  4.5–6s · hero/emotional 6–8s · closing hold 7–10s.
- **Transition by mood**: calm → `crossfade` 0.7–1.2s · upbeat → fast wipe/slide 0.35–0.6s
  · a hard beat → `none` (cut). Match cut points to the music where you can.
- **Entrance motion**: default `gentle` (fade). Use `rise`/`drift_in` sparingly for lift —
  a photo drifting in from its own edge feels intentional; everything sliding feels templated.
- **Continuous motion (Ken-Burns)**: set `"motion"` on an image layer (`zoom_in`, `zoom_out`,
  `pan_left/right/up/down`) for a slow push/drift over the whole scene. Put a gentle `zoom_in`
  on full-bleed backgrounds and on emotional hero photos — this is the single biggest lift to
  "feeling". Keep it subtle; reserve the strongest move for the peak.
- **Motion easing by mood**: on zoom/pan/kenburns *slides*, set `"easing"` to break the
  sameness of a long video — `"gentle"` (extra-soft smootherstep) on calm, portrait, and
  tender beats; `"snap"` (fast, decisive ease-out) on party/dance/peak beats; `"bounce"`
  (small overshoot that settles back) as an accent on **at most 1–2 slides per video**.
  Omit it everywhere else — the default smoothstep is the house look, and easing varying
  on every slide reads as noise, not style.
- **Card look (Canva frames)**: give photos a `"frame"` — `{ "radius": 24-32, "border": 10-16,
  "borderColor": "#FFFFFF", "shadow": true }` — for rounded, white-matted, softly shadowed cards.
  This is what makes cream-theme scenes read as "designed" rather than pasted rectangles.
- **Grade sets mood**: apply the theme's `colorGrade` globally (warm temperature + light
  `glow` for romance; `grain` + `letterbox` for a film look). Nudge per-slide for a beat.
- **Text choreography**: heading fades ~0.2s in, body ~0.6s later (`staggerSeconds`). Let
  the eye read heading → photo → line.
- **Warmth extras**: a low-opacity bokeh/light-leak `overlay` across the film ties scenes
  together. The engine bundles three analog light leaks — add
  `{ "variant": "warm" | "soft" | "sunset", "opacity": 0.4-0.7 }` to `overlays` (no `path`
  needed; blend defaults to `screen`). `warm` = golden corner glow for the nostalgic/dark-film
  look, `soft` = near-white wash for bright cream themes, `sunset` = orange-magenta for
  golden-hour beats. Alternate variants (or window them with `start`/`end`) so a long film
  doesn't repeat one leak forever; `blend: "add"` is a hotter option — drop opacity if used.
  Music `fade_in`/`fade_out` and an `automation` dip under a voiceover add polish.
- **Shape the arc**: slow, spacious opener → quicker, fuller middle → a held, tender
  closing that fades out. Don't run every scene at the same energy.

## 5. Using the layout library

Each layout in `layouts/library.json` gives you slots with fixed geometry. To render a
beat: take the layout's `background` (cream `rect` or a full-bleed photo), then for each
filled `photoSlot`/`textSlot`/`decorSlot`/`panel` emit one layer using its coordinates.
Fonts come from the theme's `fonts[fontRole]`; sizes from the slot's `sizePx` (or the
`typeScale` range). This is why you never do pixel math — the slot already is the math.

## 6. Self-check before returning

- [ ] Validates against `schema/timeline.schema.json` (durations, transitions, per-effect inputs).
- [ ] Durations vary by beat; total ≈ music length.
- [ ] No layout repeats >2× in a row; mirrors alternated.
- [ ] Every Vietnamese string uses a VN-safe font; no line overflows its slot (manual `\n`).
- [ ] `layer_scene` layers ordered background → photos → text; ids unique; paths real.
- [ ] Opener is spacious; closing is a long fade; montages sit on musical builds.

## 7. Worked reference

`timeline/white-weddings-theme-first-5.master.json` is the gold-standard shape and detail
level to match or exceed. Its 5 scenes map onto library layouts like this:

| Beat | Layout | Duration | Motion | Transition |
|------|--------|----------|--------|-----------|
| Save the Date | `hero_title_card` | 5.8s | photos fade/rise, date fades | crossfade 0.8 |
| Invitation | `text_left_photo_right` | 6.4s | photo drifts in from right | crossfade 0.7 |
| Special Day | `three_photo_row` | 4.8s | 3 photos in from their sides | crossfade 0.6 |
| Our Story | `two_photo_story` | 5.0s | portrait rises, wide drifts in | crossfade 0.6 |
| The Big Day | `collage_cluster_text` | 4.4s | cluster in, hero rises | none (last) |

Note how each scene has its **own** duration and motion — that is the target, not a
repeated block.

## 8. Output contract

Return **only** the timeline JSON (no prose), conforming to `schema/timeline.schema.json`:
`project`, `music`, `audio`, `output`, optional `color`/`overlays`, and `slides`. Prefer
`effect: "layer_scene"` for designed story cards; use `montageBeats` effects for montages.
Run it through the engine: `npx tsx src/index.ts --timeline <path>`.

---

### Pipeline roadmap (where this guide sits)

- **Phase 1 (done):** this guide + `schema/timeline.schema.json` + `layouts/library.json`.
  The AI fills a safe design-system → valid, varied, emotional timelines, repeatably.
- **Phase 2 (done):** per-layer Ken-Burns (`motion`), rounded/bordered/shadowed photo
  cards (`frame`), and auto-wrap (`wrap`). Slide entrances were already eased (smoothstep).
- **Phase 3:** automatic photo analysis (face/subject smart-crop, quality) and music
  analysis (BPM/energy) feeding the Director.
- **Phase 4:** closed-loop QA — render, vision-check frames for overflow/cropped faces,
  auto-fix, re-render.
