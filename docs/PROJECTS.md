# Isolated video projects

Each generated video lives under `projects/<id>/`. Shared engine code and shared
assets stay at repository root; customer photos, music, prompts, analysis,
timelines, logs, temporary files, and outputs never leave their project.

Create a project and optionally copy source media into it:

```powershell
npm run project:create -- --id my-video --name "My Video" `
  --prompt "A new story..." --input input --music "music/track.mp3" --quality share
```

Edit `projects/my-video/prompt.txt` when needed, set `OPENAI_API_KEY` for photo
vision and `DEEPSEEK_API_KEY` for JSON story reasoning, then
generate an AI-assisted Lite story template and validate without rendering:

```powershell
npm run lite -- --project projects/my-video --dry-run
```

Render the final video:

```powershell
npm run lite -- --project projects/my-video
```

The standard run performs project-local QA after rendering. Skip it only when
iterating on a draft, or package the verified result for delivery:

```powershell
npm run project:run -- --project projects/my-video --skip-qa
npm run project:run -- --project projects/my-video --deliver
npm run project:run -- --project projects/my-video --resume
```

Every run writes `projects/my-video/analysis/job-manifest.json`. It records the
current phase, completed/skipped/failed phases, project-local artifact paths,
and the failing command's exit code when the pipeline stops early.

`--resume` reuses only previously successful phases whose required artifacts
still exist and are not older than their direct inputs. Once one phase is stale,
that phase and every downstream phase run again.

## Tiers

All three tiers run through this same isolation, job manifest and resume logic.
They differ only in which nodes build the story and the timeline:

```powershell
npm run template -- --project projects/my-video  # an art-directed recipe, zero AI calls
npm run lite -- --project projects/my-video      # rule-based timeline, AI writes the words
npm run premium -- --project projects/my-video   # the AI-director chain (nodes 3,4,5+6,7,8+9,10+11)
```

One script, one tier per command. There is no longer a second, root-scoped way in:
`buildClip.mjs` and `runPremiumJob.mjs` are gone.

**template** applies a recipe from `story-templates/` using the full engine —
layer scenes, LUTs, reveal masks, frames. It makes **no AI calls at all**: the
copy lives in the recipe, and photo slots are matched on orientation and
sharpness, so the vision node is skipped. Vision is the only node whose cost
scales with the photo count, and a cheap tier that quietly runs the expensive
node is not a cheap tier. Set the recipe in `project.json` (`"recipe"`) or pass
`--recipe`; a missing one is a hard error rather than a silent fall back to a
default recipe the customer never chose.

**lite** generates the timeline from rules (zoom/pan/kenburns on a uniform
duration) and has DeepSeek write the words for these particular photos.

**premium** adds four story options, a customer choice with an enforced response
window, director notes, a story plan, a validate/retry/fallback loop that drops
back to Lite rather than failing, and a QA loop that repairs and re-renders.

The ladder is deliberately not a straight line: **template looks richer than
lite**, because a human art-directed it. What it cannot do is fit its words to
this particular couple's photos. That is what going up the ladder buys.

The tier is never guessed. It comes from `"tier"` in `project.json` or `--tier`.
Premium can fall back to Lite mid-run, so the tier that reaches delivery is read
from `analysis/tier.json` — written by the loop that lived through it.

If the customer has not answered yet and their window is still open, the run
exits **3** and the job manifest records `status: "paused"`. That is not a
failure: the job is waiting on a person. Re-run it when they reply.

OpenAI vision converts photos into a compact JSON manifest. DeepSeek then
receives that manifest, the prompt, and music sections. It
writes a guarded project-local `analysis/story-template.generated.json`; code
then chooses only valid files/effects and calculates scene durations so the
timeline ends with the analyzed music. Without the relevant provider key, that
node uses a deterministic stub and records `generatedBy: "stub"`.
