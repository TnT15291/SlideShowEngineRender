# Slideshow Research Notes

## What Matters For Wedding Slideshows

Research across FFmpeg documentation, FFmpeg slideshow tutorials, and commercial slideshow template catalogs points to a practical feature set for wedding photo slideshows:

- Smooth photo motion: Ken Burns style zoom/pan.
- Soft transitions: crossfade, dissolve, wipe, slide, blur, light transitions.
- Text system: title cards, chapter captions, subtitles, outro text.
- Frames and memory motifs: polaroid, photo frame, film strip, album/collage.
- Romantic atmosphere: bokeh, light leak, flare, floral frame, gold dust, soft background video.
- Multi-photo layouts: grid/collage and framed placeholders.
- Audio polish: music looping/trimming, fade in/out, playlist crossfade, voiceover ducking.
- Output compatibility: H.264 MP4, yuv420p, fixed fps/resolution.

## Sources Consulted

- FFmpeg filter documentation: libavfilter, drawtext, drawbox, overlay, xfade, zoompan, color, audio filters.
  - https://ffmpeg.org/ffmpeg-filters.html
- Mux slideshow guide: xfade transitions, drawtext captions, fps and audio handling.
  - https://www.mux.com/articles/create-a-video-slideshow-with-images-using-ffmpeg
- Mixkit slideshow template catalog: blur/fade, retro/polaroid frame, grid photo slideshow, glass/lens flare, frame/video-background placeholders.
  - https://mixkit.co/free-after-effects-templates/slideshow/
- Motion Array wedding template survey: light leaks, film overlays, warm/cinematic wedding styles, titles, photo-album style, collage stacks.
  - https://motionarray.com/learn/video-effects/wedding-video-templates/

## Engine Direction

The goal is not to expose raw FFmpeg. The goal is to expose stable wedding-slideshow concepts that compile to FFmpeg:

- `effect` presets instead of arbitrary filter strings.
- `transition` presets mapped to FFmpeg `xfade`.
- `captions` mapped to `drawtext`.
- `overlays` mapped to `overlay`/`blend`.
- `color` mapped to `eq`, `curves`, `lut3d`, `vignette`, `unsharp`, `gblur`.
- `music/audio` mapped to loop, trim, fade, acrossfade, automation, voiceover ducking.

This keeps AI-generated timelines renderable and avoids imaginary effects.

## Implemented From This Research Pass

- `video_background`
  - Uses a looping video/image background as the slide.
  - Useful for title cards, intro/outro, chapter dividers.

- `collage_grid`
  - Uses multiple images in one slide.
  - Auto-arranges a simple wedding-safe grid with white photo-card frames over a blurred background.

Already present before this pass:

- `film_roll_up`
- `film_roll_left`
- `film_roll_right`
- bokeh/light/frame overlays
- captions
- xfade transition catalog
- audio playlist/fades/voiceover ducking

## Research Pass — July 2026 (cinematic film-look)

Survey of 2026 wedding-videography trend reports and commercial template
catalogs (Envato/MotionArray/VideoHive wedding slideshows):

- Cinematic film look dominates: film grain, warm color temperature, soft
  bloom ("pro-mist"/halation), letterbox bars, lens flare / light leaks.
- Clean, true-to-color grading is the counter-trend ("timeless, not filtered").
- Motion in pro templates is eased (slow in/out), drifts toward a focus
  corner (Ken Burns), never linear.
- Double-exposure / parallax slideshows are a recurring premium template style.
- 9:16 "social-first" teaser edits are now a standard deliverable.

Sources:

- https://bridengroom.video/blog/wedding-video-trends/
- https://www.arrakisfilmswedding.com/arrakis-films-inspiration/top-wedding-videography-trends-2026-must-have-ideas-for-your-big-day
- https://fotober.com/best-wedding-video-trends-2026
- https://thewed.com/magazine/major-wedding-photography-videography-trends-for-2026
- https://www.candidstudios.net/wedding-videography-trends-2026/
- https://elements.envato.com/double-exposure-parallax-slideshow-VSKWDE3
- https://elements.envato.com/wedding-overlays-pack-F2JUWAQ
- https://motionarray.com/learn/video-effects/wedding-video-templates/
- https://www.bannerbear.com/blog/how-to-do-a-ken-burns-style-effect-with-ffmpeg/

Implemented from this pass (everything renders through presets, no free-text):

- Eased (smoothstep) motion for all zoom/pan presets.
- `kenburns_tl/tr/bl/br` — zoom-in with corner drift.
- `color.grain` (noise), `color.temperature` (colortemperature),
  `color.glow` (gbrp screen-blend bloom), `color.letterbox` (cinematic bars).
- `double_exposure` effect — two images screen-blended + slow eased zoom.
- Aspect-aware auto-reroute: cover-crop loss > 30% vs the PROJECT frame goes
  to blur-bg, so 9:16 timelines render landscape photos correctly.
- Generator `--look cinematic|film|dreamy|clean` bundles + 8-step motion cycle.

Deliberately NOT implemented (needs assets or 3D, not fakeable well in ffmpeg):

- True 3D parallax (needs depth maps / layer separation).
- Procedural light leaks — real footage looks better; use the existing
  `assets/overlays/*.mp4` light-leak/bokeh loops with `blend: "screen"`.

## Research Pass — July 2026 (Canva wedding-slideshow template styles)

Canva's own template pages cannot be scraped (login + JS-rendered, HTTP 403)
and their designs are proprietary, so this pass surveyed public descriptions
of Canva wedding-slideshow templates and matched their signature elements
against the engine:

- Canva wedding templates = clean/elegant/romantic layouts: white photo
  cards, polaroid/scrapbook stacks, circle-masked photos, collages,
  title-and-date cards, soft transitions, animated text, Beat Sync.
- Already covered by the engine: collage cards, title cards
  (`video_background`), soft xfade catalog, caption fade/slide_up, film
  strips, warm grades, bokeh/light-leak overlays.

Sources:

- https://www.canva.com/video-editor/templates/wedding-slideshows/
- https://www.canva.com/create/slideshows/
- Etsy Canva wedding-template listings (40-slide mix-and-match packs:
  collage, circle, full-bleed, title & date slide layouts).

Implemented from this pass:

- `polaroid` — photo fit (never cropped) inside a tilted white instant-photo
  card with a thick bottom border, floating with a slow eased drift over a
  blurred darkened copy of itself. rgba + `rotate=...:c=none` keeps the
  rotated corners transparent.
- `circle_focus` — center-square crop in a circular mask with a white ring
  over the blurred copy. `yuva444p` + `geq` paints the ring and carves a
  2px-feathered circular alpha (full-res chroma keeps the edge clean).

Deliberately NOT implemented:

- Beat Sync (music-driven slide timing) — needs beat detection, already a
  documented engine non-goal.
- Typewriter text — drawtext cannot reveal substrings over time; would need
  one drawtext per character prefix. Revisit only if requested.

## Research Pass — July 2026 ("Dark Classic Minimalist Film Look" template)

The user exported a Canva template as MP4 (`templates/Dark Classic Minimalist
Film Look Wedding Slideshow Video.mp4`, 1920x1080@30, first ~78s is the title
template; unrelated templates are appended after). Frame-by-frame analysis:

- One continuous "timeline wall": near-black background, a thin full-width
  rule, a serif year above it, small letter-spaced caps below it
  (name/event), alternating text-left/text-right per scene.
- Photos presented as physical media scattered at slight tilts: white-border
  prints, 35mm film negatives with sprocket rails, vertical film strips;
  1-5 photos per scene clustered opposite the text.
- Some hero scenes: a single landscape photo with edges feathered into the
  black background.
- Title/outro cards: large two-line serif couple name + italic subtitle,
  one film-framed photo, mostly empty frame.
- Motion: scenes are near-static (tiny drift); scene changes are a ~0.7s
  horizontal PUSH left, like a camera panning along the wall.

Implemented from this pass:

- `memory_wall` — 1..5 images as tilted print/negative cards (deterministic
  scatter layouts per count, sprocket-hole decoration via drawbox, rgba
  rotate with transparent corners), full-width timeline rule under the
  cards, eased ~26px cluster drift, and a caption "lockup": title = large
  serif, subtitle = year above the rule, caption = small text below. Text
  side flips deterministically with the slide-id hash (documented).
- `dark_feather` — single photo at source aspect (probed dimensions), luma/
  chroma edge ramp into black via geq (black bg makes it equal an alpha
  feather), side-margin rule segments + the same lockup. Render-heavy
  (~45s/slide at 1080p) — documented as a hero-moment effect.
- Existing `slide_left` (xfade slideleft) reproduces the push transition;
  recommended pairing documented in ENGINE_CAPABILITIES.
- Example timeline: `timeline/dark-film-demo.json` (intro card, 3-photo
  year scene, feathered hero, mirrored 4-photo scene), verified by frame
  inspection of `output/dark-film-demo.mp4`.

NOT copied: the template's fonts/stock photos (proprietary Canva assets) —
the engine look uses the repo's own Google Fonts (Playfair year/title,
Be Vietnam Pro captions).

## Implementation Pass — July 2026 (procedural light leaks + motion easing)

Reversed the earlier "don't build procedural light leaks" call. A stock light-leak
loop is a licensing liability for a paid client deliverable, and a synthesized one
turned out to look convincing enough when screen-blended over photo texture:

- `overlays/light_leak_{warm,soft,sunset}.mp4` generated by
  `scripts/generateLightLeaks.mjs` — Gaussian light blobs (`geq`) drifting on black,
  every motion term a sin/cos with period == clip duration so the loop is seamless
  (played with `-stream_loop -1`). Rendered small (384x216) then `gblur` + bicubic
  upscale hides the per-pixel origin. No `noise` filter: full-frame temporal grain
  ballooned the files 82MB -> ~2MB with no visible benefit under a 0.4-0.7 opacity
  screen blend.
- Overlay gained `variant: warm|soft|sunset` (resolves to the bundled path, defaults
  blend=screen + opacity=0.6; timeline sets either `path` or `variant`, never both)
  and `blend: "add"` (FFmpeg `addition` mode, same gbrp gotcha as screen, hotter).
- Slide-level `easing: gentle|snap|bounce` on the 10 zoompan effects only. `bounce`
  is ease-out-back normalized so its overshoot peak lands exactly at 1.0 — otherwise
  zoompan silently flattens the >1 overshoot at the frame edge and clamps break.

Still NOT implemented (unchanged): true 3D parallax (needs depth maps), beat sync,
typewriter text.
