import { useMemo, useState } from "react"
import {
  ArrowRight,
  Activity,
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  FolderOpen,
  Image,
  Layers3,
  Lightbulb,
  MoreHorizontal,
  Music2,
  Paperclip,
  Play,
  Plus,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"

const starterBrief = `Bạn là một đạo diễn phim cưới theo phong cách điện ảnh Hàn Quốc.

Kể câu chuyện của Linh và Nam từ những ngày yêu xa đến lễ cưới. Mở đầu nhẹ nhàng, phát triển cảm xúc chậm, cao trào tại khoảnh khắc trao nhẫn và kết thúc bằng cảnh hai người rời lễ đường.

Ưu tiên ảnh có tương tác tự nhiên, ánh mắt và gia đình. Màu phim ấm, ít hiệu ứng, chuyển cảnh mềm. Không dùng caption sáo rỗng.`

const moods = ["Cinematic", "Emotional", "Warm", "Elegant", "Documentary"]
const nav = [
  [WandSparkles, "AI Director", true],
  [FolderOpen, "Projects", false],
  [Image, "Assets", false],
  [Layers3, "Timeline", false],
  [Film, "Render queue", false],
] as const

export function App() {
  const [view, setView] = useState<"dashboard" | "director">("dashboard")

  return view === "dashboard"
    ? <Dashboard onCreate={() => setView("director")} />
    : <DirectorWorkspace onBack={() => setView("dashboard")} />
}

function Dashboard({ onCreate }: { onCreate: () => void }) {
  const dashboardNav = [
    [FolderOpen, "Projects", true],
    [Image, "Assets", false],
    [WandSparkles, "AI Director", false],
    [Layers3, "Timeline", false],
    [Film, "Render queue", false],
  ] as const

  const projects = [
    ["An & Huy", "Engagement film", "Completed", "AH"],
    ["Minh & Phuong", "Wedding film", "In review", "MP"],
    ["Thao & Kien", "Wedding film", "In progress", "TK"],
    ["Bao & Linh", "Wedding teaser", "Queued", "BL"],
  ]

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-sidebar px-4 py-6 text-sidebar-foreground lg:flex">
        <button onClick={() => undefined} className="flex items-center gap-3 px-2 text-left">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20"><Clapperboard className="size-5" /></div>
          <div><div className="font-serif text-xl font-semibold tracking-tight">StoReel</div><div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-muted">Moments That Move</div></div>
        </button>
        <Button onClick={onCreate} className="mt-8 w-full justify-start bg-white text-sidebar hover:bg-white/90" size="lg"><Plus className="size-4" /> New film</Button>
        <nav className="mt-8 space-y-1">
          {dashboardNav.map(([Icon, label, active]) => <button key={label} onClick={label === "AI Director" ? onCreate : undefined} className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white")}><Icon className="size-[18px]" /> {label}</button>)}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-5"><p className="text-sm font-medium">Studio Admin</p><p className="mt-1 text-xs text-sidebar-muted">Local production workspace</p></div>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between border-b px-6 md:px-10">
          <div><p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Project workspace</p><h1 className="font-serif text-xl font-semibold">Good morning, welcome back</h1></div>
          <Button onClick={onCreate} size="lg"><Plus className="size-4" /> Create new film</Button>
        </header>

        <div className="mx-auto max-w-[1440px] space-y-6 px-6 py-8 md:px-10">
          <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            <Card className="relative min-h-[360px] overflow-hidden border-0 bg-[linear-gradient(135deg,#3a302b_0%,#7b5a42_52%,#c9a878_100%)] text-white shadow-xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(255,255,255,.22),transparent_35%),linear-gradient(to_top,rgba(14,12,11,.78),transparent_65%)]" />
              <div className="absolute right-10 top-12 grid size-36 place-items-center rounded-full border border-white/20 bg-white/10 font-serif text-5xl backdrop-blur-sm">L&N</div>
              <div className="relative flex min-h-[360px] flex-col justify-end p-8">
                <Badge className="mb-4 w-fit border-0 bg-white/15 text-white">In progress</Badge>
                <h2 className="font-serif text-4xl font-semibold">Linh & Nam</h2><p className="mt-1 text-white/75">Wedding Film · May 12, 2024</p>
                <div className="mt-6 flex gap-3"><Button variant="secondary"><Play className="size-4" /> Open project</Button><Button variant="ghost" size="icon" className="text-white hover:bg-white/10 hover:text-white"><MoreHorizontal className="size-5" /></Button></div>
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Metric icon={Image} value="1,248" label="Total assets" detail="+126 this week" />
              <Metric icon={Film} value="86" label="Sequences" detail="+8 this week" />
              <Metric icon={Music2} value="312" label="Audio tracks" detail="+21 this week" />
              <Metric icon={FolderOpen} value="24" label="Projects" detail="+3 this week" />
            </div>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Render progress</CardTitle><CardDescription>Linh & Nam — Wedding Film</CardDescription></div><span className="font-serif text-3xl font-semibold text-primary">67%</span></CardHeader>
            <CardContent><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-2/3 rounded-full bg-primary" /></div><div className="mt-3 flex justify-between text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="size-2 rounded-full bg-success" /> Rendering final cut</span><span>Estimated completion: 11:30 AM</span></div></CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Recent projects</CardTitle><CardDescription>Continue where you left off</CardDescription></div><Button variant="ghost" size="sm">View all <ArrowRight className="size-4" /></Button></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{projects.map(([name, type, status, initials], index) => <div key={name} className="overflow-hidden rounded-lg border bg-background"><div className={cn("grid h-28 place-items-center font-serif text-2xl text-white", ["bg-[#8b7869]", "bg-[#65705f]", "bg-[#9b745d]", "bg-[#687a87]"][index])}>{initials}</div><div className="p-3"><p className="text-sm font-medium">{name}</p><p className="mt-0.5 text-xs text-muted-foreground">{type}</p><p className="mt-3 text-[11px] text-primary">{status}</p></div></div>)}</CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="size-4 text-primary" /> Activity</CardTitle><CardDescription>Latest updates across the studio</CardDescription></CardHeader><CardContent className="space-y-4 text-sm"><ActivityRow title="Render completed for An & Huy" time="Yesterday, 6:45 PM" /><ActivityRow title="12 new assets uploaded" time="Yesterday, 3:21 PM" /><ActivityRow title="Ceremony Highlights updated" time="Yesterday, 1:08 PM" /><ActivityRow title="Preview generated for Thao & Kien" time="May 10, 9:17 PM" /></CardContent></Card>
          </div>
        </div>
      </section>
    </main>
  )
}

function DirectorWorkspace({ onBack }: { onBack: () => void }) {
  const [brief, setBrief] = useState(starterBrief)
  const [selectedMoods, setSelectedMoods] = useState(["Cinematic", "Warm"])
  const [generated, setGenerated] = useState(false)
  const wordCount = useMemo(() => brief.trim().split(/\s+/).filter(Boolean).length, [brief])

  function toggleMood(mood: string) {
    setSelectedMoods((current) => current.includes(mood) ? current.filter((item) => item !== mood) : [...current, mood])
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-sidebar px-4 py-6 text-sidebar-foreground lg:flex">
        <button onClick={onBack} className="flex items-center gap-3 px-2 text-left">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Clapperboard className="size-5" />
          </div>
          <div>
            <div className="font-serif text-xl font-semibold tracking-tight">StoReel</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-sidebar-muted">Moments That Move</div>
          </div>
        </button>

        <Button className="mt-8 w-full justify-start bg-white text-sidebar hover:bg-white/90" size="lg">
          <Plus className="size-4" /> New film
        </Button>

        <nav className="mt-8 space-y-1">
          {nav.map(([Icon, label, active]) => (
            <button key={label} onClick={label === "Projects" ? onBack : undefined} className={cn("flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors", active ? "bg-white/10 text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-white")}>
              <Icon className="size-[18px]" /> {label}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium"><Lightbulb className="size-4 text-primary" /> Director tip</div>
          <p className="mt-2 text-xs leading-5 text-sidebar-muted">Describe the feeling and key moments. StoReel will shape the structure for you.</p>
        </div>
      </aside>

      <section className="min-w-0 flex-1">
        <header className="flex h-20 items-center justify-between border-b bg-background/90 px-6 backdrop-blur md:px-10">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">AI Director</p>
            <h1 className="font-serif text-xl font-semibold">Create a new film</h1>
          </div>
          <button className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left shadow-sm">
            <div className="grid size-8 place-items-center rounded-md bg-secondary text-xs font-semibold">LN</div>
            <div className="hidden sm:block"><div className="text-xs font-medium">Linh & Nam</div><div className="text-[11px] text-muted-foreground">Wedding film</div></div>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </header>

        <div className="mx-auto max-w-[1440px] px-6 py-8 md:px-10">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <Badge variant="secondary" className="mb-3 gap-1.5 border-0"><Sparkles className="size-3" /> Creative brief</Badge>
              <h2 className="max-w-3xl font-serif text-4xl font-semibold tracking-tight md:text-5xl">Tell us the story you want to create.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Give your AI Director a role, story outline, mood, important moments, pacing, music notes, and anything it should follow.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="grid size-5 place-items-center rounded-full bg-success text-white"><Check className="size-3" /></span> Draft saved</div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.75fr)]">
            <div className="space-y-6">
              <Card className="overflow-hidden border-border/80 shadow-[0_20px_60px_-40px_rgba(62,43,27,.35)]">
                <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-card-soft px-6 py-4">
                  <div><CardTitle className="text-base">Director instructions</CardTitle><CardDescription className="mt-1">Write naturally. Details help StoReel make better choices.</CardDescription></div>
                  <Badge variant="outline" className="font-normal">{wordCount} words</Badge>
                </CardHeader>
                <CardContent className="p-0">
                  <textarea
                    value={brief}
                    onChange={(event) => { setBrief(event.target.value); setGenerated(false) }}
                    className="min-h-[330px] w-full resize-none bg-card px-7 py-6 text-[15px] leading-7 outline-none placeholder:text-muted-foreground/70"
                    placeholder="Describe the story, emotions, visual direction, important moments, pacing, music, and anything the AI Director should follow…"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-card-soft px-5 py-4">
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm"><Paperclip className="size-4" /> Attach brief</Button>
                      <Button variant="ghost" size="sm"><Image className="size-4" /> Add references</Button>
                    </div>
                    <span className="text-xs text-muted-foreground">⌘ + Enter to generate</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Creative direction</CardTitle><CardDescription>Optional signals that guide the first set of directions.</CardDescription></CardHeader>
                <CardContent className="grid gap-6 md:grid-cols-3">
                  <label className="space-y-2 text-sm font-medium">Duration<select className="field"><option>3–5 minutes</option><option>Under 3 minutes</option><option>5–8 minutes</option></select></label>
                  <label className="space-y-2 text-sm font-medium">Format<select className="field"><option>16:9 Landscape</option><option>9:16 Vertical</option><option>1:1 Square</option></select></label>
                  <label className="space-y-2 text-sm font-medium">Music direction<select className="field"><option>Let AI decide</option><option>Follow selected track</option><option>Soft and cinematic</option></select></label>
                  <div className="md:col-span-3">
                    <p className="mb-3 text-sm font-medium">Mood</p>
                    <div className="flex flex-wrap gap-2">{moods.map((mood) => <button key={mood} onClick={() => toggleMood(mood)} className={cn("rounded-full border px-3.5 py-2 text-xs font-medium transition-colors", selectedMoods.includes(mood) ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:bg-muted")}>{selectedMoods.includes(mood) && <Check className="mr-1.5 inline size-3" />}{mood}</button>)}</div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-sidebar p-5 text-white">
                <div><p className="text-sm font-medium">Ready to explore the story?</p><p className="mt-1 text-xs text-sidebar-muted">StoReel will create 3 distinct directorial approaches for review.</p></div>
                <Button onClick={() => setGenerated(true)} size="lg" disabled={!brief.trim()}><Sparkles className="size-4" /> Generate directions <ArrowRight className="size-4" /></Button>
              </div>
            </div>

            <aside className="space-y-6">
              <Card className={cn("transition-colors", generated && "border-primary/40")}>
                <CardHeader className="flex-row items-start justify-between space-y-0">
                  <div><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-primary" /> AI understanding</CardTitle><CardDescription className="mt-1">What your director will follow</CardDescription></div>
                  <Badge variant={generated ? "default" : "secondary"}>{generated ? "Updated" : "Live"}</Badge>
                </CardHeader>
                <CardContent className="space-y-5 text-sm">
                  <Summary label="Director role" value="Korean cinematic wedding filmmaker" />
                  <Separator />
                  <Summary label="Story arc" value="Long-distance love → wedding day → leaving the ceremony together" />
                  <Separator />
                  <Summary label="Emotional peak" value="Ring exchange and family connection" />
                  <Separator />
                  <Summary label="Visual language" value="Warm palette, soft transitions, natural interaction, minimal effects" />
                  <Separator />
                  <Summary label="Avoid" value="Cliché captions and overly dramatic effects" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Proposed story flow</CardTitle><CardDescription>The structure updates as you refine the brief.</CardDescription></CardHeader>
                <CardContent className="space-y-1">
                  <Chapter number="01" title="Distance" detail="Quiet opening · letters and waiting" />
                  <Chapter number="02" title="Coming home" detail="Momentum builds · shared moments" />
                  <Chapter number="03" title="The promise" detail="Emotional peak · ring exchange" />
                  <Chapter number="04" title="Together" detail="Warm resolution · leaving as one" last />
                </CardContent>
              </Card>

              <Card className="bg-card-soft">
                <CardContent className="flex items-center gap-4 p-5">
                  <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary"><Music2 className="size-5 text-primary" /></div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">a thousand years.mp3</p><p className="text-xs text-muted-foreground">04:45 · selected soundtrack</p></div>
                  <Button variant="ghost" size="icon"><Play className="size-4" /></Button>
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </section>
    </main>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="leading-6">{value}</p></div>
}

function Metric({ icon: Icon, value, label, detail }: { icon: typeof Film; value: string; label: string; detail: string }) {
  return <Card><CardContent className="p-5"><div className="grid size-9 place-items-center rounded-lg bg-secondary text-primary"><Icon className="size-4" /></div><p className="mt-5 font-serif text-3xl font-semibold">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}</p><p className="mt-3 text-xs text-success">{detail}</p></CardContent></Card>
}

function ActivityRow({ title, time }: { title: string; time: string }) {
  return <div className="flex gap-3"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><div className="min-w-0 flex-1"><p className="truncate">{title}</p><p className="mt-1 text-xs text-muted-foreground">{time}</p></div></div>
}

function Chapter({ number, title, detail, last = false }: { number: string; title: string; detail: string; last?: boolean }) {
  return <div className="relative flex gap-3 pb-5"><div className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full border bg-background text-[10px] font-semibold text-primary">{number}</div>{!last && <div className="absolute left-[15px] top-8 h-full w-px bg-border" />}<div className="pt-1"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p></div></div>
}
