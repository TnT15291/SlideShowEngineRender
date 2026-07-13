# Engine Capabilities for AI Timeline Writers

This document is the timeline contract for Claude, DeepSeek, GPT, or any other
script writer that needs to create JSON for this slideshow engine.

## Core Output

- Target video: configurable `project.width`, `project.height`, `project.fps`.
- Recommended wedding slideshow target: `1920x1080`, `30fps`, `yuv420p`.
- Render quality is controlled by `project.quality`: `draft`, `share`,
  `high`, or `master`. If omitted, the engine uses `share`.
- Images, video backgrounds, overlays, music, captions, transitions, and color
  grading are declared in one timeline JSON file.
- Oversized still images are automatically downscaled into `temp/image-cache`
  before render. Source images are never modified. Default max edge is `2560px`;
  override with `IMAGE_CACHE_MAX_EDGE`, or set it to `0` to disable the cache.
- A preflight pass runs before rendering. It reports slide/image/music counts,
  estimated final duration, unreadable media warnings, text overflow risk, and
  hard layer-bounds errors before FFmpeg starts.
- Face-safe framing runs before render for `layer_scene` image layers. Risky
  non-background `fit: "cover"` layers are changed to `fit: "contain"` when
  their aspect-ratio crop loss is too high. Override the threshold with
  `FACE_SAFE_MAX_CROP_LOSS`; set it to `0` to disable.

## Slide Inputs

Use exactly one of these input styles per slide:

- `image`: one photo for normal photo effects.
- `images`: multiple photos for `film_roll_up`, `film_roll_left`,
  `film_roll_right`, `collage_grid` (>=2), `double_exposure` (exactly 2 used),
  or `memory_wall` (1-5).
- `background`: one looping video background for `video_background`.
- `layers`: an array of `image`/`rect`/`text` layers for `layer_scene`.

Recommended `images` count:

- Film roll: 4 to 12 photos.
- Collage grid: 2 to 6 photos.
- Memory wall: 1 to 5 photos (1 = intro/outro card or single highlight).

## Slide Effects

Supported `effect` values:

- `still`: centered cover-fill image.
- `slow_zoom_in`: Ken Burns zoom in.
- `slow_zoom_out`: Ken Burns zoom out.
- `pan_left`: slow pan from right to left.
- `pan_right`: slow pan from left to right.
- `pan_up`: slow pan upward.
- `pan_down`: slow pan downward.
- `kenburns_tl` / `kenburns_tr` / `kenburns_bl` / `kenburns_br`: zoom in while the
  crop drifts toward a corner (more cinematic than a straight pan).
- `double_exposure`: two `images` screen-blended into a dreamy superimposition,
  then a slow eased zoom. Needs 2 photos.
- `portrait_blur_background`: portrait image preserved over a blurred
  full-frame background.
- `mask_reveal`: reveals one `image` through a grayscale video supplied in
  `mask` (black = hidden, white = visible). The mask plays once and its final
  frame holds, so the slide may continue after the reveal completes. Use the
  bundled presets below instead of inventing mask paths:
  - `assets/masks/particle_gather.mp4` (`particle_reveal` in the layout
    library): glowing particles gather to reveal a hero photo. Good for a
    magical opener or emotional turn; at most once per video.
  - `assets/masks/heart_wand.mp4` (`heart_reveal`): a magic wand draws a
    glowing heart, the couple appears inside it, then the photo expands to the
    full frame. Good for a romantic opener or first-kiss beat; at most once per
    video and never together with `particle_reveal`.
  - `assets/masks/brush_stroke.mp4` (`brush_reveal`): five broad alternating
    paint strokes reveal the photo with dry-brush edges. Good for an artistic
    or scrapbook opener/chapter break; use at most one `mask_reveal` beat per
    video.

Example bundled mask reveal:

```json
{
  "id": "first-kiss-heart-reveal",
  "image": "input/first-kiss.jpg",
  "mask": "assets/masks/heart_wand.mp4",
  "duration": 6.5,
  "effect": "mask_reveal",
  "transition": { "type": "crossfade", "duration": 1.0 },
  "captions": []
}
```

All zoom/pan/kenburns motion is eased (smoothstep). Optionally set slide-level
`easing` on these effects only: `gentle` (softer, for calm/portrait beats),
`snap` (fast ease-out, for party/peak beats), or `bounce` (small overshoot,
1-2 slides per video max). The engine rejects `easing` on any other effect.
- `polaroid`: photo fit inside a tilted white instant-photo card (thick
  bottom border) floating gently over a blurred copy of itself. Never crops
  the photo. Canva/scrapbook style — good for candid or nostalgic moments.
- `circle_focus`: center-square crop of the photo inside a circular mask
  with a white ring, over a blurred copy of itself. Canva-style circle
  frame — good for portraits and couple close-ups (the center of the photo
  should contain the subject).
- `memory_wall`: dark film-look timeline scene. 1 to 5 `images` scattered as
  tilted white prints / film negatives on a near-black wall, with a thin
  timeline rule. Captions become the lockup: `title` = large serif name,
  `subtitle` = year above the rule, `caption` = small line(s) below it.
  Text sits left or right deterministically from the slide id (rename the
  id to flip). Use `slide_left` transitions between these scenes for the
  pan-along-a-wall feel. 1 image + a `title` caption makes an intro/outro
  card.
- `dark_feather`: one photo at its own aspect (never cropped) centered on
  black, edges melting softly into the background, with the same timeline
  text lockup as `memory_wall`. Slow to render (per-pixel feather) — use
  for a few hero moments. Both effects ignore caption `position`; roles
  drive placement.
- `film_roll_up`: vertical Fujifilm-style film strip moving upward.
- `film_roll_left`: horizontal Fujifilm-style film strip moving right to left.
- `film_roll_right`: horizontal Fujifilm-style film strip moving left to right.
- `video_background`: looped cinematic background video as the slide.
- `collage_grid`: multi-photo framed grid over a blurred background.
- `layer_scene`: explicit Canva-like composed scene. Use `layers` to place
  photos, text, and backing rectangles at exact frame coordinates. This is the
  preferred effect when the user asks for story text that must not overlap
  photos, photo clusters, animated small photos, or template-like layouts.

### `layer_scene` layers

Each entry in `layers` is one of `image` / `rect` / `text`, drawn back-to-front,
with `x`, `y`, `width`, `height`, `opacity`, `rotation`, `start`, `duration`, and
an entrance `animation` (`none` | `fade` | `slide_up/down/left/right`, smoothstep-eased).

- `image`: `path`, `fit` (`cover`/`contain`/`stretch`), plus:
  - `motion`: continuous Ken-Burns over the whole slide — `zoom_in`, `zoom_out`,
    `pan_left`, `pan_right`, `pan_up`, `pan_down`. Great on full-bleed backgrounds
    and hero photos.
  - `motionStrength`: optional `0.01..0.12` travel/zoom amount. Tier 1 normally
    uses `0.025` for groups and no more than `0.06` for portraits/details.
  - `easing`: optional `gentle`, `snap`, or `bounce` for layer motion.
  - `frame`: card treatment `{ radius, border, borderColor, shadow }` — rounded
    corners, a matte border (keeps the outer size), and a soft drop shadow.
- `rect`: a solid `color` panel (square corners).
- `text`: `text`, `font`, `size`, `color`, `align`, `lineSpacing`, and `wrap: true`
  to auto-wrap to the layer width (no manual `\n`).

Aliases accepted by normalization:

- `collage`, `photo_grid` -> `collage_grid`
- `background_video` -> `video_background`
- `title_card`, `intro_card` -> `video_background`
- `polaroid_card`, `photo_card`, `instant_photo` -> `polaroid`
- `circle_frame`, `circle_photo`, `circle_mask` -> `circle_focus`
- `photo_scatter`, `film_scatter`, `timeline_wall` -> `memory_wall`
- `feather`, `feathered_photo`, `soft_frame` -> `dark_feather`

## Transitions

Supported `transition.type` values:

- `none`
- `crossfade`
- `fade_fast`
- `fade_slow`
- `fade_to_black`
- `fade_to_white`
- `fade_grays`
- `dissolve`
- `pixelize`
- `radial`
- `distance`
- `blur`
- `zoom_in`
- `wipe_left`, `wipe_right`, `wipe_up`, `wipe_down`
- `wipe_tl`, `wipe_tr`, `wipe_bl`, `wipe_br`
- `slide_left`, `slide_right`, `slide_up`, `slide_down`
- `smooth_left`, `smooth_right`, `smooth_up`, `smooth_down`
- `circle_open`, `circle_close`, `circle_crop`
- `rect_crop`
- `horz_open`, `horz_close`
- `vert_open`, `vert_close`
- `diag_tl`, `diag_tr`, `diag_bl`, `diag_br`
- `slice_left`, `slice_right`, `slice_up`, `slice_down`
- `wind_left`, `wind_right`, `wind_up`, `wind_down`
- `cover_left`, `cover_right`, `cover_up`, `cover_down`
- `reveal_left`, `reveal_right`, `reveal_up`, `reveal_down`
- `squeeze_h`, `squeeze_v`

Recommended wedding durations:

- Soft emotional transitions: `0.8` to `1.5` seconds.
- Fast montage transitions: `0.35` to `0.75` seconds.

## Captions

Each slide can have `captions`.

Supported fields:

- `text`: Vietnamese text is supported.
- `role`: `title`, `subtitle`, `caption`.
- `position`: `top_center`, `center`, `bottom_center`, `none`.
- `start`: seconds from the start of this slide.
- `duration`: seconds visible.
- `font`: optional `.ttf` or `.otf` path.
- `size`: optional pixel size.
- `color`: named color or `#rrggbb`.
- `outline`: `{ "color": "...", "width": number }`.
- `shadow`: boolean.
- `animation`: `fade`, `slide_up`, `none`.

## Layer Scene

Use `effect: "layer_scene"` when a slide needs precise composition instead of
one-photo presets.

Supported layer types:

- `image`: fields `path`, `x`, `y`, `width`, `height`, `fit`.
- `text`: fields `text`, `x`, `y`, `width`, `height`, `font`, `size`,
  `color`, `align`, optional `lineSpacing`, optional `letterSpacing`.
- `rect`: fields `color`, `x`, `y`, `width`, `height`.

Shared layer fields:

- `opacity`: `0..1`.
- `rotation`: degrees.
- `start`: seconds from slide start.
- `duration`: optional visible duration.
- `animation`: `none`, `fade`, `slide_up`, `slide_down`, `slide_left`,
  `slide_right`.

Image `fit` values:

- `contain`: safest for faces and full bodies; may show empty margins.
- `cover`: fills the frame but may crop faces if the photo is not composed for
  that box.
- `stretch`: fills the box by distortion; use rarely.

Layer scene safety rules:

- Prefer `contain` for portraits, couple photos, and any photo where faces must
  be preserved.
- Give story text its own empty area or place it over a `rect` backing layer.
- Do not place small photos over the likely face area of a large photo.
- Animate both large and small photos when the slide is meant to feel dynamic.
- Use conservative font sizes and manual line breaks for Vietnamese text.

## Global And Per-Slide Color

Tier 1 first applies bounded album-relative technical normalization per image
(exposure, saturation, red/blue cast), then applies the recipe's creative grade.
Layer images carry `technicalColor`; single/multi-photo presets use the average
correction for that scene so a collage does not split into conflicting grades.

Timeline-level `color` applies to every slide. Slide-level `color` overrides it.

Supported grading fields:

- `brightness`: `-1..1`
- `contrast`: `0..3`
- `saturation`: `0..3`
- `gamma`: `0.1..10`
- `curves`: FFmpeg preset such as `vintage`, `lighter`,
  `increase_contrast`, `cross_process`.
- `lut`: path to a `.cube` LUT.
- `vignette`: boolean or number.
- `sharpen`: `0..2`.
- `blur`: Gaussian blur sigma (`0..50`, soft-focus).
- `temperature`: Kelvin (`1000..40000`; `6500` neutral, lower = warmer).
- `glow`: `0..1` dreamy bloom (blurred screen-blend over the image).
- `grain`: `0..30` animated film grain.
- `letterbox`: boolean or target aspect number (`true` = 2.39:1) — cinematic
  black bars, drawn under captions so bottom text sits in the bar.

## Overlays

Timeline-level `overlays` can add PNG frames, logos, watermarks, bokeh loops,
light leaks, and decorative videos.

Supported fields:

- `path`: `.png`, `.jpg`, `.mp4`, `.mov`, or `.webm`.
- `variant`: a bundled procedural light leak — `warm`, `soft`, or `sunset` —
  used instead of `path` (never set both). Defaults `blend` to `screen` and
  `opacity` to `0.6`. `warm` = golden top-right corner, `soft` = near-white
  top-edge wash, `sunset` = orange+magenta left sweep. Recommended opacity
  `0.4..0.7`; alternate variants or window them so one leak doesn't repeat all
  film long.
- `position`: `fullscreen`, `center`, `top_left`, `top_right`,
  `bottom_left`, `bottom_right`.
- `scale`: fraction of frame width for non-fullscreen overlays.
- `opacity`: `0..1`.
- `margin`: pixel inset for corner placement.
- `blend`: `alpha` for transparent PNG/logo/frame, `screen` for black
  background bokeh or light-leak videos, `add` for a hotter version of screen
  (clips sooner — pair with lower opacity).
- `start`: seconds in final video.
- `end`: optional end time.

Known local wedding assets (see `docs/ASSETS.md` for the full inventory + licenses):

- Bundled procedural light leaks + particles: `overlays/`
- Bundled reveal masks: `assets/masks/particle_gather.mp4`,
  `assets/masks/heart_wand.mp4`, `assets/masks/brush_stroke.mp4`
- Bokeh/light overlays: `assets/overlays/`
- Wedding backgrounds: `assets/backgrounds/`
- Decorative frame overlays: `assets/frames/`

## Audio

Supported music/audio features:

- Multiple music tracks in `music`.
- Per-track volume.
- Playlist looping to cover the whole video.
- Track crossfade through `audio.crossfade`.
- Whole-video fade in/out through `audio.fade_in` and `audio.fade_out`.
- Master volume automation points through `audio.automation`.
- Voiceover with optional ducking through `audio.voiceover`.

## Quality Presets

Set `project.quality` to choose render speed, file size, and final quality:

- `draft`: fast preview, smaller files, x264 `veryfast`, CRF `28`, audio `128k`.
- `share`: default balanced output, x264 `medium`, CRF `20`, audio `192k`.
- `high`: better archive/client output, x264 `slow`, CRF `18`, audio `256k`.
- `master`: highest local master, x264 `slow`, CRF `16`, audio `320k`.

The preset applies to per-slide video encoding, xfade recombine, overlay
re-encode, and final audio mux. Pure concat without transitions still stream
copies the already-rendered slide videos.

## What The Engine Covers Well

The engine now covers most FFmpeg features that matter for a wedding photo
slideshow:

- Ken Burns motion.
- Portrait-safe framing.
- Soft cinematic transitions.
- Film roll movement.
- Multi-photo collages.
- Video backgrounds.
- Bokeh/light/frame overlays.
- Color grading.
- Captions.
- Music playlists, crossfades, fades, automation, and voiceover ducking.
- Automatic render-time image resize/cache for oversized JPEG/PNG inputs.
- Project-level quality presets: `draft`, `share`, `high`, `master`.
- Preflight checks before render: asset counts, estimated duration, text
  overflow warnings, no-music warnings, and layer bounds errors.
- Text/photo collision preflight for `layer_scene` bounding boxes. Images drawn
  after text can hard-fail; text over images without a backing rect is warned.
- Aspect-ratio based face-safe framing for `layer_scene` photo layers.

## Current Production Readiness

The engine is usable for real wedding slideshow renders from timeline JSON. It
can now render multi-layer Canva-like scenes, animated large and small photos,
slow film-roll moments, story text, transitions, music, and Full HD MP4 output.
The render flow now includes timeline validation, face-safe framing, preflight
checks, render-time image cache, and quality presets, so repeated local
production runs are safer than the earlier manual-only flow.

For timelines that need reliable layout, prefer `layer_scene` over generic
caption placement. The engine can follow a detailed timeline JSON if the JSON
uses supported effects and keeps text/photo regions explicit.

Compared with Canva, the engine is not yet fully automatic. It does not
automatically detect faces, infer perfect crops, understand semantic subjects,
or generate advanced keyframed motion paths. Those constraints should be handled
by the timeline writer until the engine gains those features.

## Current Limits

Do not ask the AI timeline writer for arbitrary FFmpeg filtergraphs. Use the
presets above.

Current gaps compared with the full FFmpeg universe:

- No arbitrary per-object keyframes.
- No per-photo manual crop rectangle inside collage or film roll.
- No mask-shape editor beyond existing FFmpeg transition presets and PNG
  overlays.
- No real 3D camera scene.
- No beat detection.
- No true face detection yet. Current face-safe framing is aspect-ratio based:
  it prevents high-risk `cover` crops by switching photo-card layers to
  `contain`, but it does not locate eyes/faces inside the image.
- No automatic subject-aware crop; use `contain` or manual layer coordinates for
  important faces when composition must be exact.
- Text/photo collision detection is bounding-box based. It does not understand
  transparent image areas, actual rendered glyph contours, or whether an overlap
  is artistically intentional.
- Text overflow detection is heuristic; it warns from estimated text metrics,
  but only visual QA can prove exact rendered glyph fit.
- Film-roll scenes with many very large input photos are faster with the image
  cache enabled, but they can still be among the slowest scenes.
- No arbitrary particle generator, but the repo ships 3 procedural light-leak
  loops (`overlays/light_leak_*.mp4`, via `scripts/generateLightLeaks.mjs`) and
  downloaded bokeh/light overlays; use those or your own overlay videos.
- `video_background` is intended for video files, not still images.

## Recommended Next Upgrades

1. Face/subject detection for crop-safe `cover` placement.
2. Pixel/vision-based visual QA for exact text fit, subject crop, and artistic
   overlap checks.
3. Richer layer motion: per-layer easing (whole-slide effects already support
   `gentle`/`snap`/`bounce`), zoom/pan keyframes, blur reveal, and photo-stack
   shuffle.

## Recommended AI Prompt Add-On

When asking an AI model to write a wedding slideshow timeline, include this:

> Only use effects, transitions, overlays, captions, audio, and color fields
> listed in `docs/ENGINE_CAPABILITIES.md`. Do not invent raw FFmpeg filters.
> Prefer emotional pacing, 4 to 7 second photo slides, 8 to 14 second film roll
> moments, soft bokeh overlays, warm color grading, and occasional collage
> scenes for story beats.

Additional rules for `layer_scene` timelines:

1. Small photos must never cover faces or important subjects in a larger photo.
   If face/saliency is uncertain, keep small photos in a separate empty column,
   margin band, or lower corner outside the likely face area.
2. Small photos should animate into the scene. Use `slide_up`, `slide_down`,
   `slide_left`, or `slide_right` rather than placing every small photo statically
   at `t=0`.
3. Story text must stay inside its text-safe area. Manually insert line breaks
   when needed, keep font sizes conservative, and do not place story text over
   photos unless there is a solid/transparent backing box.
4. The story must be based on both the visible photo content and the user's
   supplied story notes. Do not invent relationship milestones that are not in
   the photos or user-provided context. If the user gives a story outline, map
   each line/beat to nearby photos and use that beat as the slide text.
