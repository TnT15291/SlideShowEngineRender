import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Check, Clapperboard, Crown, LockKeyhole, Search, Sparkles, WandSparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { apiMessage } from "@/lib/apiMessage"
import { useI18n, type Locale, type Translate } from "@/lib/i18n"
import type { StringKey } from "@/lib/strings"
import { cn } from "@/lib/utils"
import { RecipeSwatch } from "@/components/RecipeSwatch"
import { languageLabelKey, musicModeLabelKey, qualityLabelKey, sequenceLabelKey, tierLabelKey } from "@/projectFormat"
import { localized, photoRange, tagLabel } from "@/recipeFormat"
import type { CreateProjectInput, ProjectSummary, RecipeSummary } from "@/types"

const initialForm: CreateProjectInput = {
  name: "", bride: "", groom: "", language: "vi", sequenceMode: "editorial",
  tier: "template", quality: "share", musicMode: "auto", creativeBrief: "",
}

type DetailField = "name" | "bride" | "groom"

const detailMessageKeys: Record<DetailField, StringKey> = {
  name: "intake.field.nameRequired",
  bride: "intake.field.brideRequired",
  groom: "intake.field.groomRequired",
}

// "1 render credit" used to be listed on all three cards, which made the
// comparison read as if the tiers were priced identically and told nobody why
// they'd pick one over another. It's the same for every tier, so it's stated
// once below the cards instead — leaving only what actually differs here.
const tiers = [
  { id: "template", icon: Clapperboard, description: "intake.tier.templateDescription", turnaround: "intake.tier.templateTurnaround", depth: "intake.tier.templateDepth" },
  { id: "lite", icon: Sparkles, description: "intake.tier.liteDescription", turnaround: "intake.tier.liteTurnaround", depth: "intake.tier.liteDepth" },
  { id: "premium", icon: Crown, description: "intake.tier.premiumDescription", turnaround: "intake.tier.premiumTurnaround", depth: "intake.tier.premiumDepth" },
] as const satisfies ReadonlyArray<{ id: CreateProjectInput["tier"]; icon: typeof Clapperboard; description: StringKey; turnaround: StringKey; depth: StringKey }>

const stepLabelKeys: StringKey[] = ["intake.step.details", "intake.step.direction", "intake.step.output"]

export function IntakeWizard({ onBack, onCreated }: { onBack: () => void; onCreated: (project: ProjectSummary) => void }) {
  const { t, locale } = useI18n()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<CreateProjectInput>(initialForm)
  const [recipes, setRecipes] = useState<RecipeSummary[]>([])
  const [loadingRecipes, setLoadingRecipes] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recipeQuery, setRecipeQuery] = useState("")
  const [recipeMood, setRecipeMood] = useState("all")
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DetailField, string>>>({})
  const [creationMode, setCreationMode] = useState<"quick" | "custom">("quick")

  useEffect(() => {
    apiGet<RecipeSummary[]>("/recipes").then(setRecipes).catch((reason: unknown) => setError(apiMessage(reason, t))).finally(() => setLoadingRecipes(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function update<K extends keyof CreateProjectInput>(key: K, value: CreateProjectInput[K]) {
    setError(null)
    setForm((current) => ({ ...current, [key]: value }))
    if (key === "name" || key === "bride" || key === "groom") {
      setFieldErrors((current) => ({ ...current, [key]: undefined }))
    }
  }

  function validateDetailField(field: DetailField) {
    const message = form[field].trim() ? undefined : t(detailMessageKeys[field])
    setFieldErrors((current) => ({ ...current, [field]: message }))
  }

  function detailsAreValid() {
    const fields: DetailField[] = ["name", "bride", "groom"]
    const nextErrors = Object.fromEntries(fields.filter((field) => !form[field].trim()).map((field) => [field, t(detailMessageKeys[field])])) as Partial<Record<DetailField, string>>
    setFieldErrors(nextErrors)
    const firstInvalidField = fields.find((field) => nextErrors[field])
    if (firstInvalidField) {
      requestAnimationFrame(() => document.getElementById(firstInvalidField)?.focus())
      return false
    }
    return true
  }

  function continueFromDetails() {
    if (!detailsAreValid()) return
    setStep(1)
  }

  function chooseTier(tier: CreateProjectInput["tier"]) {
    setForm((current) => ({ ...current, tier, recipe: tier === "template" ? current.recipe : undefined, creativeBrief: tier === "template" ? "" : current.creativeBrief }))
  }

  const directionReady = form.tier !== "template" || Boolean(form.recipe)
  const selectedRecipe = recipes.find((recipe) => recipe.id === form.recipe)
  const recipeMoods = [...new Set(recipes.flatMap((recipe) => recipe.moods))].sort()
  const recommendedRecipe = [...recipes].sort((left, right) =>
    (right.bestFor.length + right.moods.length + Number(Boolean(right.intro))) -
    (left.bestFor.length + left.moods.length + Number(Boolean(left.intro)))
  )[0]
  const visibleRecipes = recipes.filter((recipe) => {
    const query = recipeQuery.trim().toLowerCase()
    const matchesQuery = !query || [recipe.name, recipe.notes, ...recipe.moods, ...recipe.bestFor].some((value) => value.toLowerCase().includes(query))
    return matchesQuery && (recipeMood === "all" || recipe.moods.includes(recipeMood))
  })

  async function submit(input = form) {
    setSubmitting(true)
    setError(null)
    try {
      onCreated(await apiPost<ProjectSummary>("/projects", input))
    } catch (reason) {
      setError(apiMessage(reason, t))
    } finally {
      setSubmitting(false)
    }
  }

  async function submitQuickProject() {
    if (!detailsAreValid() || !recommendedRecipe) return
    await submit({ ...form, tier: "template", recipe: recommendedRecipe.id, sequenceMode: "editorial", quality: "share", musicMode: "auto", creativeBrief: "" })
  }

  return <main className="min-h-screen bg-background text-foreground">
    <header className="flex min-h-20 items-center gap-3 border-b px-3 py-3 sm:gap-4 sm:px-6 md:px-10"><Button aria-label={step === 0 ? t("intake.backToDashboard") : t("intake.previousStep")} variant="ghost" size="icon" onClick={step === 0 ? onBack : () => setStep((current) => current - 1)}><ArrowLeft className="size-4" /></Button><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("intake.eyebrow")}</p><h1 className="font-serif text-base font-semibold sm:text-xl">{t("intake.title")}</h1></div><nav aria-label={t("intake.progressNav")} className="ml-auto"><p className="mb-1 text-right text-xs font-medium text-muted-foreground">{t("intake.stepCounter", { current: step + 1, total: stepLabelKeys.length })}</p><ol className="flex gap-1 sm:gap-2">{stepLabelKeys.map((labelKey, index) => {
      // A completed step is navigable — the workspace stepper two screens later
      // behaves that way, and these looked identical while doing nothing.
      const done = index < step
      const content = <><span aria-hidden="true">{done ? <Check className="size-3.5" /> : index > step ? <LockKeyhole className="size-3.5" /> : index + 1}</span><span className="sr-only">{done ? t("intake.step.completed") : index > step ? t("intake.step.locked") : t("intake.step.current")}</span><span className="hidden sm:inline">{t(labelKey)}</span></>
      const shell = cn("flex items-center gap-2 rounded-full px-2 py-1.5 text-xs sm:px-3", index === step ? "bg-primary text-primary-foreground" : done ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground")
      return <li key={labelKey} aria-current={index === step ? "step" : undefined}>{done
        ? <button type="button" onClick={() => setStep(index)} className={cn(shell, "transition-colors hover:bg-secondary/70")}>{content}</button>
        : <span className={shell}>{content}</span>}</li>
    })}</ol></nav></header>

    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}

      {step === 0 && <section><PageTitle title={t("intake.details.title")} description={t(creationMode === "quick" ? "intake.quick.description" : "intake.details.description")} /><div className="mb-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setCreationMode("quick")} className={cn("rounded-xl border p-4 text-left transition", creationMode === "quick" ? "border-primary bg-primary/10 ring-2 ring-primary" : "bg-card hover:border-primary/40")}><span className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> {t("intake.quick.title")}</span><span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{t("intake.quick.hint")}</span></button><button type="button" onClick={() => setCreationMode("custom")} className={cn("rounded-xl border p-4 text-left transition", creationMode === "custom" ? "border-primary bg-primary/10 ring-2 ring-primary" : "bg-card hover:border-primary/40")}><span className="flex items-center gap-2 text-sm font-semibold"><WandSparkles className="size-4 text-primary" /> {t("intake.custom.title")}</span><span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{t("intake.custom.hint")}</span></button></div><Card><CardContent className="grid gap-5 p-6 md:grid-cols-2">
        <p className="text-xs text-muted-foreground md:col-span-2"><span className="font-semibold text-destructive" aria-hidden="true">*</span> {t("common.requiredFields")}</p>
        <Field label={t("intake.field.name")} htmlFor="name" required error={fieldErrors.name}><input id="name" className="field" value={form.name} onChange={(event) => update("name", event.target.value)} onBlur={() => validateDetailField("name")} placeholder={t("intake.field.namePlaceholder")} required aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "name-error" : undefined} /></Field><div />
        <Field label={t("intake.field.bride")} htmlFor="bride" required error={fieldErrors.bride}><input id="bride" className="field" value={form.bride} onChange={(event) => update("bride", event.target.value)} onBlur={() => validateDetailField("bride")} placeholder="Linh" required aria-invalid={Boolean(fieldErrors.bride)} aria-describedby={fieldErrors.bride ? "bride-error" : undefined} /></Field>
        <Field label={t("intake.field.groom")} htmlFor="groom" required error={fieldErrors.groom}><input id="groom" className="field" value={form.groom} onChange={(event) => update("groom", event.target.value)} onBlur={() => validateDetailField("groom")} placeholder="Nam" required aria-invalid={Boolean(fieldErrors.groom)} aria-describedby={fieldErrors.groom ? "groom-error" : undefined} /></Field>
        <Field label={t("intake.field.videoLanguage")} htmlFor="language" required description={t("intake.field.videoLanguageHint")}><select id="language" className="field" value={form.language} onChange={(event) => update("language", event.target.value as CreateProjectInput["language"])} aria-describedby="language-description"><option value="vi">{t("lang.vi")}</option><option value="en">{t("lang.en")}</option></select></Field>
        <fieldset><legend className="text-sm font-medium">{t("intake.sequence.legend")}<span className="ml-1 text-destructive" aria-hidden="true">*</span></legend><p id="sequence-description" className="mt-1 text-xs leading-5 text-muted-foreground">{t("intake.sequence.hint")}</p><div className="mt-2 grid gap-2">{[
          { value: "editorial", title: t("sequence.editorial"), description: t("intake.sequence.editorialDetail") },
          { value: "chronological", title: t("sequence.chronological"), description: t("intake.sequence.chronologicalDetail") },
        ].map((option) => <label key={option.value} className={cn("flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 transition focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2", form.sequenceMode === option.value && "border-primary bg-primary/10 ring-2 ring-primary")}><input type="radio" name="sequenceMode" value={option.value} checked={form.sequenceMode === option.value} onChange={() => update("sequenceMode", option.value as CreateProjectInput["sequenceMode"])} className="mt-1 size-5 accent-[var(--primary)]" required={option.value === "editorial"} aria-describedby="sequence-description" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 text-sm font-medium">{option.title}{option.value === "editorial" && <Badge className="border-0 text-[10px]">{t("common.recommended")}</Badge>}{form.sequenceMode === option.value && <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary-text"><Check className="size-3.5" aria-hidden="true" /> {t("common.selected")}</span>}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.description}</span></span></label>)}</div></fieldset>
      </CardContent></Card></section>}

      {step === 1 && <section><PageTitle title={t("intake.direction.title")} description={t("intake.direction.description")} /><div className="grid gap-4 md:grid-cols-3">{tiers.map(({ id, icon: Icon, description, turnaround, depth }) => <button key={id} type="button" onClick={() => chooseTier(id)} aria-pressed={form.tier === id} className="text-left"><Card className={cn("h-full transition hover:border-primary/40", form.tier === id ? "border-primary ring-2 ring-primary" : "border-border")}><CardHeader><div className="flex items-start justify-between gap-2"><div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-5" /></div>{form.tier === id && <span className="inline-flex items-center gap-1 text-xs font-semibold text-primary-text"><Check className="size-3.5" aria-hidden="true" /> {t("common.selected")}</span>}</div><CardTitle className="mt-4">{t(tierLabelKey[id])}</CardTitle><CardDescription className="leading-6">{t(description)}</CardDescription><div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground"><p>{t(turnaround)}</p><p>{t(depth)}</p></div></CardHeader></Card></button>)}</div>
        <p className="mt-3 text-xs text-muted-foreground">{t("intake.creditNote")}</p>
        {form.tier === "template" ? <Card className="mt-6"><CardHeader><CardTitle className="text-base">{t("intake.recipe.title")}</CardTitle><CardDescription>{t("intake.recipe.description")}</CardDescription></CardHeader><CardContent>{loadingRecipes ? <p className="text-sm text-muted-foreground">{t("intake.recipe.loading")}</p> : <><div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]"><label className="relative flex"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">{t("intake.recipe.search")}</span><input className="field mt-0 pl-9" value={recipeQuery} onChange={(event) => setRecipeQuery(event.target.value)} placeholder={t("intake.recipe.search")} /></label><label><span className="sr-only">{t("intake.recipe.filterByMood")}</span><select className="field mt-0" value={recipeMood} onChange={(event) => setRecipeMood(event.target.value)}><option value="all">{t("intake.recipe.allMoods")}</option>{recipeMoods.map((mood) => <option key={mood} value={mood}>{tagLabel(mood, t)}</option>)}</select></label></div>{/* The fit panel belongs with the selection, not 3,000 px below it. */}{selectedRecipe?.intro && <RecipeFit name={selectedRecipe.name} intro={selectedRecipe.intro} t={t} locale={locale} />}<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleRecipes.map((recipe) => <RecipeChoice key={recipe.id} recipe={recipe} selected={form.recipe === recipe.id} recommended={recipe.id === recommendedRecipe?.id} onSelect={() => update("recipe", recipe.id)} t={t} locale={locale} />)}</div>{visibleRecipes.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("intake.recipe.noMatches")}</p>}</>}</CardContent></Card> : <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><WandSparkles className="size-4 text-primary" /> {t("intake.brief.title")}</CardTitle><CardDescription>{t("intake.brief.description")}</CardDescription></CardHeader><CardContent><textarea className="min-h-56 w-full resize-y rounded-lg border bg-background p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring/30" value={form.creativeBrief} onChange={(event) => update("creativeBrief", event.target.value)} placeholder={t("intake.brief.placeholder")} /><p className="mt-2 text-right text-xs text-muted-foreground">{form.creativeBrief.length}/10,000</p></CardContent></Card>}
      </section>}

      {step === 2 && <section><PageTitle title={t("intake.output.title")} description={t("intake.output.description")} /><div className="grid gap-6 lg:grid-cols-[1fr_.8fr]"><Card><CardHeader><CardTitle className="text-base">{t("intake.output.settings")}</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><Field label={t("intake.output.quality")} htmlFor="quality" required description={t("intake.output.qualityHint")}><select id="quality" className="field" value={form.quality} onChange={(event) => update("quality", event.target.value as CreateProjectInput["quality"])} aria-describedby="quality-description"><option value="draft">{t("quality.draft")}</option><option value="share">{t("quality.share")}</option><option value="high">{t("quality.high")}</option><option value="master">{t("quality.master")}</option></select></Field><Field label={t("intake.output.musicMode")} htmlFor="music-mode" required description={t("intake.output.musicModeHint")}><select id="music-mode" className="field" value={form.musicMode} onChange={(event) => update("musicMode", event.target.value as CreateProjectInput["musicMode"])} aria-describedby="music-mode-description"><option value="auto">{t("musicMode.auto")}</option><option value="highlight">{t("musicMode.highlight")}</option><option value="full_song">{t("musicMode.full_song")}</option></select></Field></CardContent></Card><Card><CardHeader><CardTitle className="text-base">{t("intake.contract.title")}</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><ReviewRow label={t("intake.contract.project")} value={form.name} /><ReviewRow label={t("intake.contract.couple")} value={`${form.bride} & ${form.groom}`} /><ReviewRow label={t("intake.contract.tier")} value={t(tierLabelKey[form.tier])} /><ReviewRow label={t("intake.contract.recipe")} value={selectedRecipe?.name || form.recipe || t("common.notApplicable")} /><ReviewRow label={t("intake.contract.language")} value={t(languageLabelKey[form.language] ?? "lang.vi")} /><ReviewRow label={t("intake.contract.sequence")} value={t(sequenceLabelKey[form.sequenceMode] ?? "sequence.editorial")} /><ReviewRow label={t("intake.output.quality")} value={t(qualityLabelKey[form.quality] ?? "quality.share")} /><ReviewRow label={t("intake.output.musicMode")} value={t(musicModeLabelKey[form.musicMode] ?? "musicMode.auto")} /></CardContent></Card></div></section>}

      {/* Sticky: step 2 is a ~4,000 px scroll of recipe cards, so selecting the
          first one used to mean scrolling back past all of them to continue. */}
      <div className="sticky bottom-0 -mx-6 mt-8 flex items-end justify-between gap-4 border-t bg-background/95 px-6 py-4 backdrop-blur md:-mx-10 md:px-10"><Button variant="ghost" onClick={step === 0 ? onBack : () => setStep((current) => current - 1)}>{step === 0 ? t("intake.backToDashboard") : t("common.back")}</Button>{step === 0 && creationMode === "quick" ? <div className="text-right"><p className="mb-2 text-xs text-muted-foreground">{t("intake.quick.defaults")}</p><Button onClick={() => void submitQuickProject()} disabled={submitting || loadingRecipes || !recommendedRecipe}>{submitting ? t("intake.creating") : t("intake.quick.create")} <ArrowRight className="size-4" /></Button></div> : step < 2 ? <div className="text-right">{step === 1 && !directionReady && <p className="mb-2 text-xs text-muted-foreground">{t("intake.selectRecipeToContinue")}</p>}<Button onClick={step === 0 ? continueFromDetails : () => setStep((current) => current + 1)} disabled={step === 1 && !directionReady}>{t("common.continue")} <ArrowRight className="size-4" /></Button></div> : <Button onClick={() => void submit()} disabled={submitting}>{submitting ? t("intake.creating") : t("intake.create")} <ArrowRight className="size-4" /></Button>}</div>
    </div>
  </main>
}

function RecipeChoice({ recipe, selected, recommended, onSelect, t, locale }: { recipe: RecipeSummary; selected: boolean; recommended: boolean; onSelect: () => void; t: Translate; locale: Locale }) {
  const range = photoRange(recipe, t)
  const summary = localized(recipe.intro?.summary, locale)
  return <button
    type="button"
    onClick={onSelect}
    aria-pressed={selected}
    className={cn("overflow-hidden rounded-xl border text-left transition hover:border-primary/50 hover:shadow-sm", selected ? "border-primary ring-2 ring-primary" : "border-border")}
  >
    <RecipeSwatch recipe={recipe} />
    <div className="p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {recommended && <Badge className="border-0 text-[10px]">{t("intake.recipe.mostVersatile")}</Badge>}
        {selected && <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary-text"><Check className="size-3.5" aria-hidden="true" /> {t("common.selected")}</span>}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{range || t("intake.recipe.anyPhotoCount")} · {t("recipes.scenesAndLooks", { scenes: recipe.sceneCount, looks: recipe.signatureCount })}</p>
      {summary && <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{summary}</p>}
      <div className="mt-3 flex flex-wrap gap-1">{recipe.moods.slice(0, 3).map((mood) => <Badge key={mood} variant="secondary" className="border-0 text-[10px] font-normal">{tagLabel(mood, t)}</Badge>)}</div>
    </div>
  </button>
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return <div className="mb-6"><h2 className="font-serif text-3xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>
}

function Field({ label, htmlFor, required, description, error, children }: { label: string; htmlFor: string; required?: boolean; description?: string; error?: string; children: React.ReactNode }) {
  const { t } = useI18n()
  return <div><label htmlFor={htmlFor} className="text-sm font-medium">{label}{required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : <span className="ml-1 text-xs font-normal text-muted-foreground">{t("common.optional")}</span>}</label>{description && <p id={`${htmlFor}-description`} className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}{children}{error && <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs font-medium text-destructive">{error}</p>}</div>
}

// No `capitalize` here any more: the values are translated labels that already
// carry their own casing, and the rule title-cased every Vietnamese word.
function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>
}

function RecipeFit({ name, intro, t, locale }: { name: string; intro: NonNullable<RecipeSummary["intro"]>; t: Translate; locale: Locale }) {
  return <div className="mb-5 rounded-lg border border-primary/40 bg-secondary/40 p-4 text-sm"><p className="mb-3 flex items-center gap-2 font-medium"><Check className="size-4 text-primary-text" aria-hidden="true" /> {name}</p><div className="grid gap-4 sm:grid-cols-3">
    <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("intake.recipe.bestPhotoFit")}</p><p className="mt-1 leading-5">{localized(intro.photos, locale)}</p></div>
    <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("intake.recipe.bestStoryFit")}</p><p className="mt-1 leading-5">{localized(intro.story, locale)}</p></div>
    <div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("intake.recipe.bestMusicFit")}</p><p className="mt-1 leading-5">{localized(intro.music, locale)}</p></div>
  </div></div>
}
