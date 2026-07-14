// Deterministic Tier-1 direction: one auditable decision artifact for visual
// identity and pacing. Every returned id comes from the recipe/library menus.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const arg = (flag, def = "") => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : def; };
const read = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const prompt = fs.existsSync(path.resolve(root, arg("--prompt")))
  ? fs.readFileSync(path.resolve(root, arg("--prompt")), "utf8").trim().toLowerCase() : "";
const recipe = read(arg("--recipe"));
const library = read(arg("--library", "layouts/library.json"));
const photos = read(arg("--photos")).photos || [];
const music = read(arg("--music"));
const outPath = arg("--out", "analysis/tier1_direction.json");
const pacingOverride = arg("--pacing", "").toLowerCase();

const styleRules = [
  { match: /super\s?8|8mm|home.?movie|phim cũ/, theme: "super8_nostalgia", reason: "prompt requests an 8mm/home-movie treatment" },
  { match: /editorial|tạp chí|thời trang|fashion/, theme: "editorial_bold", reason: "prompt requests editorial/fashion styling" },
  { match: /hiện đại|modern|minimal|tối giản|teal/, theme: "modern_teal", reason: "prompt requests modern/minimal styling" },
  { match: /điện ảnh|cinematic|moody|trầm|dark/, theme: "dark_film", reason: "prompt requests cinematic/moody styling" },
  { match: /hoài niệm|vintage|film|ấm|warm|mộc/, theme: "warm_film", reason: "prompt requests warm/nostalgic styling" },
];
const rule = styleRules.find((r) => r.match.test(prompt));
const requestedTheme = rule?.theme;
const themeId = requestedTheme && library.designTokens?.themes?.[requestedTheme]
  ? requestedTheme : recipe.libraryTheme;
const theme = library.designTokens.themes[themeId];
if (!theme) throw new Error(`Tier-1 direction: unknown theme ${themeId}`);

let overlayId = "recipe_default";
let overlays = recipe.defaults?.overlays || [];
if (/không overlay|no overlay|clean|sạch/.test(prompt)) { overlayId = "none"; overlays = []; }
else if (/sunset|hoàng hôn/.test(prompt)) { overlayId = "sunset"; overlays = [{ variant: "sunset", position: "fullscreen", opacity: 0.25, blend: "screen" }]; }
else if (/mềm|soft|dịu/.test(prompt)) { overlayId = "soft"; overlays = [{ variant: "soft", position: "fullscreen", opacity: 0.22, blend: "screen" }]; }
else if (/ấm|warm|golden/.test(prompt)) { overlayId = "warm"; overlays = [{ variant: "warm", position: "fullscreen", opacity: 0.25, blend: "screen" }]; }
else if (theme.recommendedOverlays) { overlayId = `${themeId}_recommended`; overlays = theme.recommendedOverlays; }

const duration = Math.max(1, Number(music.duration) || 1);
const photoDensity = photos.length / (duration / 60);
const sections = music.sections || [];
const buildRatio = sections.filter((s) => s.kind === "build").reduce((n, s) => n + (s.dur || 0), 0) / duration;
const calmRatio = sections.filter((s) => s.kind === "calm").reduce((n, s) => n + (s.dur || 0), 0) / duration;
let paceScore = 0;
paceScore += ((music.energy?.mean ?? 0.5) - 0.45) * 2;
paceScore += ((music.bpmEstimate ?? 100) - 100) / 100;
paceScore += Math.min(0.5, buildRatio * 2);
paceScore -= Math.min(0.5, calmRatio * 0.6);
paceScore += Math.max(-0.3, Math.min(0.5, (photoDensity - 18) / 40));
if (/nhanh|fast|dynamic|sôi động|vui nhộn/.test(prompt)) paceScore += 0.65;
if (/chậm|slow|nhẹ nhàng|thư thả|tĩnh/.test(prompt)) paceScore -= 0.65;

const variants = recipe.pacingVariants;
if (!Array.isArray(variants) || variants.length < 3) throw new Error(`${recipe.id} has no Tier-1 pacing variants`);
if (pacingOverride && !["gentle", "balanced", "lively"].includes(pacingOverride)) throw new Error(`--pacing must be gentle|balanced|lively`);
const index = pacingOverride === "gentle" ? 0 : pacingOverride === "lively" ? variants.length - 1
  : pacingOverride === "balanced" ? Math.floor(variants.length / 2)
    : paceScore < -0.25 ? 0 : paceScore > 0.35 ? variants.length - 1 : Math.floor(variants.length / 2);
const pacing = variants[index];
const paceClass = index === 0 ? "gentle" : index === variants.length - 1 ? "lively" : "balanced";
const controls = paceClass === "gentle"
  ? { durationMultiplier: pacing.durationMultiplier, transitionMultiplier: 1.15, repeatLimit: 1, montagePhotoMultiplier: 0.8 }
  : paceClass === "lively"
    ? { durationMultiplier: pacing.durationMultiplier, transitionMultiplier: 0.75, repeatLimit: 3, montagePhotoMultiplier: 1.25 }
    : { durationMultiplier: pacing.durationMultiplier, transitionMultiplier: 1, repeatLimit: 2, montagePhotoMultiplier: 1 };

// Capacity clamp — in the DIRECTION, so it is the same direction whether it was built
// for a preview or a straight render. generateTier1Previews used to patch this in after
// the fact, which meant a customer who skipped previews rendered at a montage density
// no preview had ever shown them.
const minPhotos = recipe.fit?.minPhotos || 0;
const capacityLimited = photos.length < minPhotos
  ? { availablePhotos: photos.length, recipeMinPhotos: minPhotos,
      reason: "photo set is below the recipe's floor; montage density reduced to avoid photo reuse" }
  : null;
if (capacityLimited) {
  controls.repeatLimit = 1;
  controls.montagePhotoMultiplier = Math.min(1, controls.montagePhotoMultiplier);
}

const doc = {
  version: 1, generatedBy: pacingOverride ? "preview_override" : "rules", generatedAt: new Date().toISOString(), recipeId: recipe.id,
  style: {
    themeId, paletteId: themeId, fontPairId: `${path.basename(theme.fonts.heading, path.extname(theme.fonts.heading))}+${path.basename(theme.fonts.body, path.extname(theme.fonts.body))}`,
    fonts: theme.fonts, overlayId, overlays, reason: rule?.reason || `recipe default theme ${themeId}`,
  },
  pacing: {
    variantId: pacing.id, class: paceClass, score: +paceScore.toFixed(3), controls,
    ...(capacityLimited ? { capacityLimited } : {}),
    evidence: { bpm: music.bpmEstimate ?? null, meanEnergy: music.energy?.mean ?? null, buildRatio: +buildRatio.toFixed(3), calmRatio: +calmRatio.toFixed(3), photosPerMinute: +photoDensity.toFixed(2) },
  },
};
fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(doc, null, 2) + "\n");
console.log(`[chooseTier1Direction] style=${themeId}/${overlayId}, pacing=${pacing.id} (${paceScore.toFixed(2)}) -> ${outPath}`);
