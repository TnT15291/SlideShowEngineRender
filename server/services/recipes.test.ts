import assert from "node:assert/strict"
import test from "node:test"

import { listRecipes } from "./recipes.js"

test("recipe service reads and sorts the engine recipe library", async () => {
  const recipes = await listRecipes()
  assert.ok(recipes.length >= 20)
  assert.deepEqual(recipes.map((recipe) => recipe.name), recipes.map((recipe) => recipe.name).sort((a, b) => a.localeCompare(b)))
  const warmFilm = recipes.find((recipe) => recipe.id === "warm-film-01")
  assert.ok(warmFilm)
  assert.equal(warmFilm.libraryTheme, "warm_film")
  assert.equal(warmFilm.minPhotos, 35)
  assert.ok(warmFilm.sceneCount > 0)
})
