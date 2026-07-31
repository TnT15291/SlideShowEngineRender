# Hybrid scene renderer

The timeline is the single source of truth. Each slide chooses one backend and
all backends emit the same intermediate contract: H.264, project resolution and
FPS, yuv420p, no audio. FFmpeg then owns transitions, overlays, music and final
encoding.

```text
Timeline JSON
  -> normalize / validate / face-safe / preflight
  -> compileTimeline
  -> renderer router
       ffmpeg   -> native filters and simple 2D scenes
       remotion -> React/CSS/GPU layout and transitions
       blender  -> real 3D camera, light and page geometry
  -> normalize external clip
  -> scene cache
  -> FFmpeg final assembly
```

## Timeline contract

Existing timelines need no changes: `renderer` defaults to `ffmpeg`.

```json
{
  "id": "album-opening",
  "renderer": "remotion",
  "template": "page_flip",
  "assets": ["input/a.jpg", "input/b.jpg"],
  "params": { "paperColor": "#f7f3eb" },
  "duration": 6,
  "effect": "still",
  "transition": { "type": "crossfade", "duration": 0.8 },
  "captions": []
}
```

`effect` remains present for backward-compatible timeline tooling. External
renderers use `template`, `assets` and `params` instead.

## Templates currently implemented

- Remotion: `title`, `filmstrip`, `page_flip`, `portrait_echo`, `triptych`,
  `card_gallery`, `paper_peel`, `panel_reveal`, `floating_frame`, `light_rays`,
  `gl_transition`, `glass_frame`, `confetti_bloom`, `shared_frame_morph`,
  `kinetic_typography`, `dither_dissolve`,
  `image_echo_trail`, `glass_refraction`, `audio_reactive`,
  `particle_dissolve`.
- Blender: `page_flip_3d`, `camera_gallery_3d`, `ring_spin_reveal`, `photo_frame_orbit`.

### GPU / trending additions (2026-07-16)

- **`gl_transition`** (Remotion, needs 2 assets) — a real GPU shader wipe between two
  photos, rendered with `@remotion/three` + the `gl-transitions` shader catalog (already
  installed, previously unused). `params.name` picks the shader; curated allow-list:
  `heart`, `kaleidoscope`, `cube`, `doorway`, `circleopen`, `ripple`, `windowslice`,
  `DreamyZoom`, `FilmBurn`, `morph` (defaults to `heart`). `params.shaderParams` overrides
  that shader's own uniforms (e.g. `{ "count": 14 }` for `windowslice`). Both photos are
  center-cropped to fill the frame (`object-fit: cover`), not letterboxed.
- **`glass_frame`** (Remotion) — glassmorphism reveal: blurred full-bleed backdrop behind
  a frosted glass panel (`backdrop-filter`) holding the sharp photo, with one light-sweep
  highlight crossing the glass early in the shot. `params.tint` is an `"r,g,b"` string for
  the glass/sweep color (default white).
- **`confetti_bloom`** (Remotion) — react-three-fiber scene: ~46 soft blush/ivory/gold/sage
  petal sprites (procedural canvas texture, on-brand with the garden/silk story templates)
  drift in from the edges and settle around the photo while the camera gently dollies in.
  `params.background` sets the CSS backdrop color behind the 3D canvas.
- **`shared_frame_morph`** (Remotion, needs 4 assets) — starts as a 2x2 photo
  gallery, then preserves one selected thumbnail while tweening its bounds and
  corner radius into a full-frame hero. A slow push-in runs under the whole
  shot so the held gallery and the held hero are not frozen frames.
  `params.heroIndex` selects the hero (`0..3`, default `0`); `params.background`
  sets the backdrop.
- **`kinetic_typography`** (Remotion) — staggers a headline character by
  character with rise, rotation and blur-to-sharp motion. Use `params.title`,
  `params.subtitle`, `params.color`, `params.fontFamily` and `params.fontSize`.
  `params.fontFamily` names a font the way `layouts/library.json` does — by repo
  path, e.g. `fonts/CormorantGaramond-Regular.ttf` — and the renderer publishes
  `fonts/` into `public/fonts/` so the browser can load it. Anything else is
  treated as a plain CSS stack and loads nothing, which on a Vietnamese film is
  a real risk: a host font without the stacked-tone vowels (ố, ầ, …) detaches
  the tone marks. See `gpu-effects/fonts.ts`.
- **`dither_dissolve`** (Remotion, needs 2 assets) — GPU ordered dither
  (Bayer 8x8) from the first photograph to the second: a halftone crosshatch,
  not a noise wipe. The dot size scales with the output resolution.
- **`image_echo_trail`** (Remotion) — one hero photograph moves along a curved
  editorial path while delayed soft copies preserve its motion history.
  `params.copies` accepts `5..14`.
- **`glass_refraction`** (Remotion, needs 2 assets) — a procedural glass lens
  crosses the screen, refracting and revealing the second photograph.
- **`audio_reactive`** (Remotion) — scale, brightness and rings pulse on beats.
  Supply local frame numbers in `params.beatFrames`; when omitted,
  `params.bpm` generates a regular beat grid. On the premium path
  `composeStoryboard` fills `params.bpm` from the analysed track, so the pulse
  is the song's tempo rather than the component's 120 BPM placeholder. Nothing
  produces `beatFrames` yet, so the grid is regular, not onset-accurate.
  `audio_reactive` carries the beat in light — an exposure and vignette swell —
  rather than drawing rings over the photograph.
- **`particle_dissolve`** (Remotion, needs 2 assets) — GPU cells scatter the
  outgoing photograph and expose the incoming photograph with a warm edge.
- **`ring_spin_reveal`** (Blender, EEVEE, needs 1 asset) — a procedural gold band with a
  faceted stone spins low in the near foreground while the camera racks focus from the ring
  back to the photograph behind it, revealing it full-frame under warm corner bokeh.
  Wedding-intro motif. The ring and the bokeh are sized and placed **relative to the camera
  frustum**, not in hand-picked world units, so the composition holds at any project
  resolution; the ring stands on the side away from `focusX` so the reveal lands on a face
  rather than behind gold. The photo plane is fitted to the frustum and the image is
  cover-cropped at its own aspect around `focusX`/`focusY` — a portrait keeps its faces
  instead of being stretched to the plane. Params: `ringScale` (ring diameter as a fraction
  of frame height, default `0.54`), `spinDegrees` (default `700`, an ease-out landing just
  off face-on), `ringDistance`/`photoDistance` (the two ends of the focus rack, default
  `2.4`/`9.0`), `photoBrightness` (default `1.0`; the backdrop is unlit so it reads as the
  photograph, not as the photograph relit).
- **`photo_frame_orbit`** (Blender, EEVEE, needs 1 asset) — camera slowly orbits a single
  hanging photo frame with warm bokeh "string light" points defocused in the background.

The `ring_spin_reveal`/`photo_frame_orbit` Blender templates use EEVEE (real lighting,
raytracing, depth of field) instead of Workbench — `page_flip_3d`/`camera_gallery_3d` stay
on Workbench since their flat-page look doesn't need it and Workbench renders faster.

EEVEE accumulates depth of field across TAA samples, so `params.renderSamples` (default
`32`) is the bokeh-quality dial and the cost dial at once, and it is the reason these two
are minutes per scene. Measured on this workstation at 1080p, marginal cost per frame:

| `renderSamples` | s/frame @1080p | 6s scene @30fps | PSNR vs 64 |
| --- | --- | --- | --- |
| 64 | 8.0 | ~24 min | — |
| 32 (default) | 4.5 | ~13 min | ~62 dB |

62 dB is visually lossless and it holds frame to frame, so 32 does not shimmer in motion —
which is the failure mode a still frame will not show you. Drop it further for previews;
raise it only if a particular scene shows noise in the bokeh.

The Blender CLI is resolved from `BLENDER_PATH`, then from `blender` on PATH.
On this workstation the engine also auto-detects the installed user-local
portable Blender 5.2 build under `%LOCALAPPDATA%/Programs/BlenderPortable-5.2`.

```powershell
$env:BLENDER_PATH = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
npm run render -- --timeline timeline/my-hybrid-film.json
```

## Cache

Normalized clips are stored in `temp/scene-cache/`. The key includes renderer,
template, params, scene geometry, captions/layers and source file size/mtime.
Changing an input or instruction invalidates only the affected scene.

## Framing and dressing

Two things reach every template through `params` without a recipe writing them:

- **`focusX` / `focusY`** — put there by `src/renderRemotionScene.ts` and
  `src/renderBlenderScene.ts` from the slide's
  focal point, the same one every native effect crops around. Templates that
  cover-fit a photograph pass it to `object-position` via `focusPosition()` in
  `gpu-effects/framing.ts`. Skipping it is not a neutral default: a wedding
  portrait cover-fitted into a wide tile is cropped top and bottom, and a centred
  crop takes the faces off first.

  Every Blender template does the same through `cover_photo_uvs()`, which bakes the
  cover-fit window into the mesh's UVs. Baked into UVs rather than done with a
  shader Mapping node because **Workbench ignores the shader graph** and samples
  the image straight off the UV map — four of the six templates render on Workbench,
  so a Mapping node there is silently a no-op. Before this, every Blender template
  stretched the photograph to whatever aspect its plane happened to be: a 3:4
  portrait on `photo_frame_orbit`'s 1.59 plane came out 2.4x too wide.
- **`background` and `fontFamily`** — filled in by `scripts/applyStoryTemplate.mjs`
  from the film's own theme, so a signature scene is dressed like the twenty
  scenes around it instead of in whatever colour its component hardcoded. A
  recipe that states either on purpose still wins.

## Composition size

Remotion templates are authored against a 1920x1080 frame. Positions are written
as percentages, but distances things TRAVEL are literal pixels, scaled to the
output through `scaleX`/`scaleY` in `gpu-effects/hybrid-scene.tsx`. Add a new
travel distance the same way: an unscaled one composes correctly at 1080p and
flies its card off the canvas at any smaller size, which is a blank frame, not a
smaller version of the shot.

## Smoke test

```powershell
npm run render -- --timeline timeline/hybrid-renderer-example.json
```

Pixels, not routing. `test/hybrid-renderer.test.mjs` dry-runs the timeline and
proves the right template name reaches the renderer; it cannot see what lands on
screen, and two shipped templates rendered blank frames underneath a green run of
it. `test/regression/hybrid-scene-render.test.mjs` renders every Remotion
template for real — at 1080p against per-template baselines, and once more at
640x360 — and is the test to run after touching anything in `gpu-effects/`:

```powershell
node --test --test-timeout=2400000 test/regression/hybrid-scene-render.test.mjs
```
