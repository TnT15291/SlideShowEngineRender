import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

const recipeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  libraryTheme: z.string().optional(),
  intro: z.object({
    summary: z.string().optional(),
    photos: z.string().optional(),
    story: z.string().optional(),
    music: z.string().optional(),
  }).optional(),
  fit: z.object({
    bestFor: z.array(z.string()).optional(),
    minPhotos: z.number().optional(),
    idealPhotos: z.number().optional(),
    maxPhotos: z.number().optional(),
  }).optional(),
  musicProfile: z.object({
    moods: z.array(z.string()).optional(),
    energy: z.string().optional(),
  }).optional(),
  looks: z.record(z.object({ layout: z.string() }).passthrough()).optional(),
  scenes: z.array(z.object({
    layout: z.string().optional(),
    look: z.string().optional(),
    effect: z.string().optional(),
    renderer: z.string().optional(),
    template: z.string().optional(),
  }).passthrough()).optional(),
  pacingVariants: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  source: z.object({ notes: z.string().optional() }).optional(),
  storyArc: z.object({ sequence: z.array(z.string()).optional() }).optional(),
  defaults: z.object({
    palette: z.record(z.string()).optional(),
    fonts: z.record(z.string()).optional(),
  }).optional(),
}).passthrough()

const librarySchema = z.object({
  designTokens: z.object({
    themes: z.record(z.object({
      background: z.string().optional(),
      palette: z.object({ accent: z.string().optional() }).passthrough().optional(),
    }).passthrough()),
  }),
}).passthrough()

export const recipeSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  libraryTheme: z.string().nullable(),
  themeBackground: z.string().nullable(),
  themeAccent: z.string().nullable(),
  intro: z.object({
    summary: z.string(),
    photos: z.string(),
    story: z.string(),
    music: z.string(),
  }).nullable(),
  bestFor: z.array(z.string()),
  minPhotos: z.number().nullable(),
  idealPhotos: z.number().nullable(),
  maxPhotos: z.number().nullable(),
  moods: z.array(z.string()),
  energy: z.string().nullable(),
  storyArc: z.array(z.string()),
  palette: z.record(z.string()),
  fonts: z.record(z.string()),
  sceneCount: z.number().int().nonnegative(),
  signatureCount: z.number().int().nonnegative(),
  layoutCount: z.number().int().nonnegative(),
  effectCount: z.number().int().nonnegative(),
  pacingVariants: z.array(z.string()),
  notes: z.string(),
})

export type RecipeSummary = z.infer<typeof recipeSummarySchema>

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"))
  } catch (error) {
    throw new Error(`Unable to read recipe data at ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function listRecipes(engineRoot = process.cwd()): Promise<RecipeSummary[]> {
  const templateDir = path.join(engineRoot, "story-templates")
  const library = librarySchema.parse(await readJson(path.join(engineRoot, "layouts", "library.json")))
  const files = (await readdir(templateDir)).filter((file) => file.endsWith(".json")).sort()

  const recipes = await Promise.all(files.map(async (file) => {
    const recipe = recipeSchema.parse(await readJson(path.join(templateDir, file)))
    const scenes = recipe.scenes || []
    const theme = recipe.libraryTheme ? library.designTokens.themes[recipe.libraryTheme] : undefined
    return recipeSummarySchema.parse({
      id: recipe.id,
      name: recipe.name,
      libraryTheme: recipe.libraryTheme || null,
      themeBackground: theme?.background || null,
      themeAccent: theme?.palette?.accent || null,
      intro: recipe.intro ? {
        summary: recipe.intro.summary || "",
        photos: recipe.intro.photos || "",
        story: recipe.intro.story || "",
        music: recipe.intro.music || "",
      } : null,
      bestFor: recipe.fit?.bestFor || [],
      minPhotos: recipe.fit?.minPhotos ?? null,
      idealPhotos: recipe.fit?.idealPhotos ?? null,
      maxPhotos: recipe.fit?.maxPhotos ?? null,
      moods: recipe.musicProfile?.moods || [],
      energy: recipe.musicProfile?.energy || null,
      storyArc: recipe.storyArc?.sequence || [],
      palette: recipe.defaults?.palette || {},
      fonts: recipe.defaults?.fonts || {},
      sceneCount: scenes.length,
      // How many distinct PICTURES the recipe composes, how many library primitives it
      // spends them on, and how many render behaviours it uses. A recipe that dresses one
      // layout as three looks scores 3/1, not 1/1 -- and it cannot cheat by declaring
      // looks that render alike, because scripts/lib/lookResolver.mjs (V7) refuses to lint
      // a recipe whose two looks resolve to the same picture. On a recipe with no looks
      // signatureCount is exactly the layout count this used to report.
      signatureCount: new Set(scenes.flatMap((scene) => {
        const composition = scene.look ?? scene.layout
        return composition ? [composition] : []
      })).size,
      layoutCount: new Set(scenes.flatMap((scene) => {
        const layout = scene.layout ?? (scene.look ? recipe.looks?.[scene.look]?.layout : undefined)
        return layout ? [layout] : []
      })).size,
      effectCount: new Set(scenes.flatMap((scene) => {
        if (scene.renderer && scene.template) return [`${scene.renderer}:${scene.template}`]
        return scene.effect ? [scene.effect] : []
      })).size,
      pacingVariants: (recipe.pacingVariants || []).map((variant) => variant.id),
      notes: recipe.source?.notes || "",
    })
  }))

  return recipes.sort((left, right) => left.name.localeCompare(right.name))
}

export async function getRecipe(recipeId: string, engineRoot = process.cwd()): Promise<RecipeSummary | null> {
  const recipes = await listRecipes(engineRoot)
  return recipes.find((recipe) => recipe.id === recipeId) || null
}
