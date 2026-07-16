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
  `card_gallery`, `paper_peel`, `panel_reveal`, `floating_frame`, `light_rays`.
- Blender: `page_flip_3d`, `camera_gallery_3d`.

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
