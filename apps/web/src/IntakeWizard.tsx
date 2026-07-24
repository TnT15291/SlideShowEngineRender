import { useEffect, useState } from "react"
import { ArrowLeft, ArrowRight, Check, Clapperboard, Crown, Sparkles, WandSparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, apiPost } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { CreateProjectInput, ProjectSummary, RecipeSummary } from "@/types"

const initialForm: CreateProjectInput = {
  name: "", bride: "", groom: "", language: "vi", sequenceMode: "editorial",
  tier: "template", quality: "share", musicMode: "auto", creativeBrief: "",
}

const tiers = [
  { id: "template", title: "Template", icon: Clapperboard, description: "Fast, deterministic, and built from a proven recipe." },
  { id: "lite", title: "Lite", icon: Sparkles, description: "AI-assisted story with a streamlined creative path." },
  { id: "premium", title: "Premium", icon: Crown, description: "Full AI Director choices, music decisions, and advanced QA." },
] as const

export function IntakeWizard({ onBack, onCreated }: { onBack: () => void; onCreated: (project: ProjectSummary) => void }) {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<CreateProjectInput>(initialForm)
  const [recipes, setRecipes] = useState<RecipeSummary[]>([])
  const [loadingRecipes, setLoadingRecipes] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<RecipeSummary[]>("/recipes").then(setRecipes).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoadingRecipes(false))
  }, [])

  function update<K extends keyof CreateProjectInput>(key: K, value: CreateProjectInput[K]) {
    setError(null)
    setForm((current) => ({ ...current, [key]: value }))
  }

  function chooseTier(tier: CreateProjectInput["tier"]) {
    setForm((current) => ({ ...current, tier, recipe: tier === "template" ? current.recipe : undefined, creativeBrief: tier === "template" ? "" : current.creativeBrief }))
  }

  const detailsReady = Boolean(form.name.trim() && form.bride.trim() && form.groom.trim())
  const directionReady = form.tier !== "template" || Boolean(form.recipe)

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      onCreated(await apiPost<ProjectSummary>("/projects", form))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="min-h-screen bg-background text-foreground">
    <header className="flex h-20 items-center gap-4 border-b px-6 md:px-10"><Button variant="ghost" size="icon" onClick={step === 0 ? onBack : () => setStep((current) => current - 1)}><ArrowLeft className="size-4" /></Button><div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Create new film</p><h1 className="font-serif text-xl font-semibold">Project intake</h1></div><div className="ml-auto flex gap-2">{["Details", "Direction", "Output"].map((label, index) => <div key={label} className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-xs", index === step ? "bg-primary text-primary-foreground" : index < step ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground")}>{index < step && <Check className="size-3" />}{index + 1}. {label}</div>)}</div></header>

    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      {error && <Card className="mb-6 border-destructive/40 bg-destructive/5"><CardContent className="p-5 text-sm text-destructive">{error}</CardContent></Card>}

      {step === 0 && <section><PageTitle title="Who is this film for?" description="Create the project identity before adding media or running the pipeline." /><Card><CardContent className="grid gap-5 p-6 md:grid-cols-2"><Field label="Project name"><input className="field" value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Linh & Nam — Wedding Film" /></Field><div /><Field label="Bride"><input className="field" value={form.bride} onChange={(event) => update("bride", event.target.value)} placeholder="Linh" /></Field><Field label="Groom"><input className="field" value={form.groom} onChange={(event) => update("groom", event.target.value)} placeholder="Nam" /></Field><Field label="Video language"><select className="field" value={form.language} onChange={(event) => update("language", event.target.value as CreateProjectInput["language"])}><option value="vi">Vietnamese</option><option value="en">English</option></select></Field><Field label="Photo sequence"><select className="field" value={form.sequenceMode} onChange={(event) => update("sequenceMode", event.target.value as CreateProjectInput["sequenceMode"])}><option value="editorial">Editorial — best visual story</option><option value="chronological">Chronological — upload order</option></select></Field></CardContent></Card></section>}

      {step === 1 && <section><PageTitle title="Choose the directing path" description="Template uses a fixed recipe. Lite and Premium accept a free-form creative brief." /><div className="grid gap-4 md:grid-cols-3">{tiers.map(({ id, title, icon: Icon, description }) => <button key={id} onClick={() => chooseTier(id)} className="text-left"><Card className={cn("h-full transition", form.tier === id && "border-primary ring-2 ring-primary/15")}><CardHeader><div className="grid size-10 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-5" /></div><CardTitle className="mt-4">{title}</CardTitle><CardDescription className="leading-6">{description}</CardDescription></CardHeader></Card></button>)}</div>
        {form.tier === "template" ? <Card className="mt-6"><CardHeader><CardTitle className="text-base">Select a recipe</CardTitle><CardDescription>A recipe is required. StoReel will never choose a hidden default.</CardDescription></CardHeader><CardContent>{loadingRecipes ? <p className="text-sm text-muted-foreground">Loading recipes…</p> : <div className="grid max-h-96 gap-3 overflow-y-auto pr-2 sm:grid-cols-2">{recipes.map((recipe) => <button key={recipe.id} onClick={() => update("recipe", recipe.id)} className={cn("rounded-lg border p-4 text-left transition hover:border-primary/50", form.recipe === recipe.id && "border-primary bg-primary/5 ring-1 ring-primary")}><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{recipe.name}</p><p className="mt-1 text-xs text-muted-foreground">{recipe.minPhotos ?? "—"}–{recipe.idealPhotos ?? "—"} photos · {recipe.sceneCount} scenes</p></div>{form.recipe === recipe.id && <Check className="size-4 text-primary" />}</div><div className="mt-3 flex flex-wrap gap-1">{recipe.moods.slice(0, 3).map((mood) => <Badge key={mood} variant="secondary" className="border-0 text-[10px]">{mood}</Badge>)}</div></button>)}</div>}</CardContent></Card> : <Card className="mt-6"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><WandSparkles className="size-4 text-primary" /> Director instructions</CardTitle><CardDescription>Describe the role, story, emotional arc, visual language, music, and anything the AI Director must follow.</CardDescription></CardHeader><CardContent><textarea className="min-h-56 w-full resize-y rounded-lg border bg-background p-4 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring/30" value={form.creativeBrief} onChange={(event) => update("creativeBrief", event.target.value)} placeholder="Tell StoReel the story you want to create…" /><p className="mt-2 text-right text-xs text-muted-foreground">{form.creativeBrief.length}/10,000</p></CardContent></Card>}
      </section>}

      {step === 2 && <section><PageTitle title="Output and confirmation" description="Review the project contract. Media upload happens after creation." /><div className="grid gap-6 lg:grid-cols-[1fr_.8fr]"><Card><CardHeader><CardTitle className="text-base">Output settings</CardTitle></CardHeader><CardContent className="grid gap-5 sm:grid-cols-2"><Field label="Quality"><select className="field" value={form.quality} onChange={(event) => update("quality", event.target.value as CreateProjectInput["quality"])}><option value="draft">Draft</option><option value="share">Share</option><option value="high">High</option><option value="master">Master</option></select></Field><Field label="Music mode"><select className="field" value={form.musicMode} onChange={(event) => update("musicMode", event.target.value as CreateProjectInput["musicMode"])}><option value="auto">Auto</option><option value="highlight">Highlight</option><option value="full_song">Full song</option></select></Field></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Project contract</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><ReviewRow label="Project" value={form.name} /><ReviewRow label="Couple" value={`${form.bride} & ${form.groom}`} /><ReviewRow label="Tier" value={form.tier} /><ReviewRow label="Recipe" value={form.recipe || "Not applicable"} /><ReviewRow label="Language" value={form.language} /><ReviewRow label="Sequence" value={form.sequenceMode} /><ReviewRow label="Quality" value={form.quality} /></CardContent></Card></div></section>}

      <div className="mt-8 flex justify-between"><Button variant="ghost" onClick={step === 0 ? onBack : () => setStep((current) => current - 1)}>Back</Button>{step < 2 ? <Button onClick={() => setStep((current) => current + 1)} disabled={step === 0 ? !detailsReady : !directionReady}>Continue <ArrowRight className="size-4" /></Button> : <Button onClick={submit} disabled={submitting}>{submitting ? "Creating…" : "Create project"} <ArrowRight className="size-4" /></Button>}</div>
    </div>
  </main>
}

function PageTitle({ title, description }: { title: string; description: string }) {
  return <div className="mb-6"><h2 className="font-serif text-3xl font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p></div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-sm font-medium">{label}{children}</label>
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4 border-b pb-3 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium capitalize">{value}</span></div>
}
