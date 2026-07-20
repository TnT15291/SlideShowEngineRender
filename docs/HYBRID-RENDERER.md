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
  `gl_transition`, `glass_frame`, `confetti_bloom`.
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
- **`ring_spin_reveal`** (Blender, EEVEE, needs 1 asset) — a procedural gold ring with a
  glass gem spins in the foreground while the camera racks focus from the ring back to the
  photo behind it, revealing it in soft bokeh. Wedding-intro motif.
- **`photo_frame_orbit`** (Blender, EEVEE, needs 1 asset) — camera slowly orbits a single
  hanging photo frame with warm bokeh "string light" points defocused in the background.

The `ring_spin_reveal`/`photo_frame_orbit` Blender templates use EEVEE (real lighting,
raytracing, depth of field) instead of Workbench — `page_flip_3d`/`camera_gallery_3d` stay
on Workbench since their flat-page look doesn't need it and Workbench renders faster.

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

## Smoke test

```powershell
npm run render -- --timeline timeline/hybrid-renderer-example.json
```
