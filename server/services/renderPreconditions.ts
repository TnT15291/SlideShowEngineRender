import { HttpError } from "../http.js"

import type { ProjectAssets } from "./assets.js"
import type { ProjectSummary } from "./projects.js"
import type { RecipeSummary } from "./recipes.js"

/**
 * Everything that has to be true before a render is worth charging for.
 *
 * These used to be checked nowhere. The web UI printed a recipe's photo range
 * in the picker AND on the Direct step, then let a customer start a render with
 * three photos against a recipe that declares a minimum of eighteen. The run
 * consumed a credit, failed in the `build` phase seconds later without
 * rendering a frame, and reported itself with a Node stack trace.
 *
 * The check lives on the server rather than in `AssetsPage` so the CLI, a
 * retry, and any future client all inherit the same guarantee — and so it can
 * run *before* `consumeRenderEntitlement`, which is the only ordering that
 * makes the credit safe.
 */
export function assertRenderPreconditions(input: {
  project: ProjectSummary
  assets: ProjectAssets
  recipe: RecipeSummary | null
}): void {
  const photos = input.assets.photos.length
  const music = input.assets.music.length

  if (photos === 0) {
    throw new HttpError(409, "NO_PHOTOS", "Add at least one photo before creating the video", { photos })
  }
  if (music === 0) {
    throw new HttpError(409, "NO_MUSIC", "Add at least one soundtrack before creating the video", { music })
  }

  // Only a Template project is pinned to a recipe; Lite and Premium compose
  // their own shot list, so there is no authored minimum to hold them to.
  const min = input.recipe?.minPhotos ?? null
  if (min !== null && photos < min) {
    throw new HttpError(
      409,
      "RECIPE_PHOTO_RANGE",
      `This style needs at least ${min} photos; ${photos} have been added`,
      { photos, minPhotos: min, idealPhotos: input.recipe?.idealPhotos ?? null, recipe: input.recipe?.name ?? input.project.recipe },
    )
  }
  // Deliberately no upper bound: over `maxPhotos` the solver simply selects a
  // subset, which is a fine outcome and not worth blocking a paid run over.
}
