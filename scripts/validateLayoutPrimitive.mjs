// Validate one layout primitive candidate or every primitive in layouts/library.json.
//
// Usage:
//   node scripts/validateLayoutPrimitive.mjs layouts/library.json
//   node scripts/validateLayoutPrimitive.mjs path/to/candidate.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rotatedSlotBounds } from "./lib/lookResolver.mjs";
import {
  SCENE_PHOTO_COVERAGE_MIN,
  SCENE_PHOTO_COVERAGE_MIN_TEXTED,
  SLOT_AREA_FLOOR,
  SLOT_AREA_FLOOR_GRID,
  minimumTextSize,
  textSafeInsets,
} from "./lib/rules/thresholds.mjs";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };
const isFiniteBox = (slot) => [slot?.x, slot?.y, slot?.width, slot?.height]
  .every(Number.isFinite) && slot.width > 0 && slot.height > 0;
const intersection = (a, b) => {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), width, height };
};
const area = (box) => box.width * box.height;
const finding = (gate, severity, layoutId, slotId, detail) => ({
  gate, severity, layoutId, ...(slotId ? { slotId } : {}), detail,
});

export function layoutsFromDocument(document) {
  if (Array.isArray(document?.layouts)) {
    if (!document.layouts.length) throw new Error("input contains an empty 'layouts' array");
    return document.layouts;
  }
  if (document && typeof document === "object" && typeof document.id === "string") {
    return [document];
  }
  throw new Error("input must contain a 'layouts' array or one layout object with an 'id'");
}

export function loadLayoutInput(inputPath, root = process.cwd()) {
  const absolutePath = path.resolve(root, inputPath);
  const document = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  return {
    absolutePath,
    document,
    layouts: layoutsFromDocument(document),
  };
}

function validateLayout(layout, context) {
  const errors = [];
  const warnings = [];
  const add = (gate, severity, slotId, detail) => {
    (severity === "warning" ? warnings : errors).push(
      finding(gate, severity, layout.id, slotId, detail),
    );
  };
  const canvas = context.canvas ?? DEFAULT_CANVAS;
  const safe = textSafeInsets(canvas, context.textSafeMargin);
  const framePresets = context.framePresets ?? {};
  const canvasArea = canvas.width * canvas.height;
  const photoSlots = layout.photoSlots ?? [];
  const textSlots = layout.textSlots ?? [];
  const backgroundSlot = layout.background?.type === "photo_full_bleed"
    ? layout.background.slot
    : null;
  const fullBleed = Boolean(backgroundSlot);

  // G1 — raw rectangles must fit the same hard canvas boundary as preflight.
  for (const slot of [...photoSlots, ...textSlots]) {
    if (!isFiniteBox(slot)) {
      add("G1", "error", slot.id, "x/y/width/height must be finite numbers with positive width and height");
      continue;
    }
    if (slot.x < 0 || slot.y < 0
      || slot.x + slot.width > canvas.width || slot.y + slot.height > canvas.height) {
      add("G1", "error", slot.id,
        `${slot.x},${slot.y} ${slot.width}x${slot.height} is outside ${canvas.width}x${canvas.height}`);
    }
  }

  const slotAreas = photoSlots.map((slot) => ({
    id: slot.id,
    fraction: isFiniteBox(slot) ? area(slot) / canvasArea : 0,
  }));

  // G2/G3 — full-bleed and photoless layouts are exempt, matching templateRules.
  if (photoSlots.length && !fullBleed) {
    const floor = photoSlots.length >= 6 ? SLOT_AREA_FLOOR_GRID : SLOT_AREA_FLOOR;
    for (const slotArea of slotAreas) {
      if (slotArea.fraction < floor) {
        add("G2", "error", slotArea.id,
          `covers ${(slotArea.fraction * 100).toFixed(1)}% of canvas; minimum is ${(floor * 100).toFixed(0)}%`);
      }
    }
    const coverage = slotAreas.reduce((sum, slotArea) => sum + slotArea.fraction, 0);
    const minimum = layout.textRequired
      ? SCENE_PHOTO_COVERAGE_MIN_TEXTED
      : SCENE_PHOTO_COVERAGE_MIN;
    if (coverage < minimum) {
      add("G3", "error", undefined,
        `photos cover ${(coverage * 100).toFixed(1)}% of canvas; minimum is ${(minimum * 100).toFixed(0)}%`);
    }
  }

  // G4/G5 — safe area is advisory; type scale is intentionally warning-only.
  for (const slot of textSlots) {
    if (isFiniteBox(slot)
      && (slot.x < safe.x || slot.y < safe.y
        || slot.x + slot.width > canvas.width - safe.x
        || slot.y + slot.height > canvas.height - safe.y)) {
      add("G4", "warning", slot.id,
        `lies outside the title-safe margin (${safe.x}px across, ${safe.y}px down)`);
    }
    const minimum = minimumTextSize(slot);
    if (!Number.isFinite(slot.sizePx) || slot.sizePx < minimum) {
      add("G5", "warning", slot.id,
        `uses ${Number.isFinite(slot.sizePx) ? `${slot.sizePx}px` : "no sizePx"}; recommended minimum is ${minimum}px`);
    }
  }

  // G6 — any text/photo collision needs a panel protecting at least 80% of it.
  const panels = (layout.panels ?? []).filter((panel) => panel.z === "over_photos");
  for (const textSlot of textSlots.filter(isFiniteBox)) {
    for (const photoSlot of photoSlots.filter(
      (slot) => slot.id !== backgroundSlot && isFiniteBox(slot),
    )) {
      const collision = intersection(textSlot, photoSlot);
      const collisionArea = area(collision);
      if (!collisionArea) continue;
      const protectedArea = panels.reduce(
        (largest, panel) => isFiniteBox(panel)
          ? Math.max(largest, area(intersection(collision, panel)))
          : largest,
        0,
      );
      if (protectedArea / collisionArea < 0.8) {
        add("G6", "error", textSlot.id,
          `overlaps photo slot '${photoSlot.id}' without a panel protecting at least 80% of the collision`);
      }
    }
  }

  // G7 — rotate expands the rendered rectangle while overlay keeps the raw x/y.
  for (const slot of photoSlots.filter((candidate) => candidate.rotation && isFiniteBox(candidate))) {
    const bounds = rotatedSlotBounds(slot);
    if (bounds.x < 0 || bounds.y < 0
      || bounds.right > canvas.width || bounds.bottom > canvas.height) {
      add("G7", "error", slot.id,
        `${slot.rotation}° renders as ${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)} ` +
        `at ${bounds.x},${bounds.y}, outside ${canvas.width}x${canvas.height}`);
    }
  }

  // G8 — inline frame objects are valid; named frames must resolve.
  for (const slot of photoSlots) {
    const preset = typeof slot.frame === "string" ? framePresets[slot.frame] : undefined;
    if (typeof slot.frame === "string"
      && (!preset || typeof preset !== "object" || Array.isArray(preset))) {
      add("G8", "error", slot.id, `names unknown frame preset '${slot.frame}'`);
    }
  }

  const coverage = fullBleed
    ? null
    : slotAreas.reduce((sum, slotArea) => sum + slotArea.fraction, 0);
  return {
    id: layout.id,
    verdict: errors.length ? "fail" : "pass",
    slotAreas,
    coverage,
    errors,
    warnings,
  };
}

export function validateLayouts(layouts, context = {}) {
  const reports = layouts.map((layout) => validateLayout(layout, context));
  const errors = reports.flatMap((report) => report.errors);
  const warnings = reports.flatMap((report) => report.warnings);
  return {
    verdict: errors.length ? "fail" : "pass",
    reports,
    errors,
    warnings,
  };
}

function validationContext(input, root = process.cwd()) {
  const canonicalPath = path.resolve(root, "layouts/library.json");
  const canonical = Array.isArray(input.document?.layouts)
    ? input.document
    : JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
  return {
    canvas: input.document?.meta?.canvas ?? canonical.meta?.canvas ?? DEFAULT_CANVAS,
    textSafeMargin: input.document?.meta?.textSafeMargin ?? canonical.meta?.textSafeMargin,
    framePresets: {
      ...(canonical.designTokens?.framePreset ?? {}),
      ...(input.document?.designTokens?.framePreset ?? {}),
      ...(input.document?.layoutPresets ?? {}),
    },
  };
}

function printReport(input, report) {
  console.log(`[validateLayoutPrimitive] ${input.absolutePath}`);
  console.log(`Loaded ${input.layouts.length} layout(s).`);
  for (const layout of report.reports) {
    const coverage = layout.coverage == null
      ? "full-bleed"
      : `${(layout.coverage * 100).toFixed(1)}% coverage`;
    console.log(`${layout.verdict === "pass" ? "PASS" : "FAIL"} ${layout.id} — ${coverage}`);
    for (const slot of layout.slotAreas) {
      console.log(`  photo ${slot.id}: ${(slot.fraction * 100).toFixed(1)}%`);
    }
    for (const item of [...layout.errors, ...layout.warnings]) {
      console.log(`  ${item.severity === "error" ? "ERROR" : "warn "} ${item.gate}` +
        `${item.slotId ? ` [${item.slotId}]` : ""} ${item.detail}`);
    }
  }
  const passed = report.reports.filter((layout) => layout.verdict === "pass").length;
  console.log(`[validateLayoutPrimitive] ${passed}/${report.reports.length} pass, ` +
    `${report.errors.length} error(s), ${report.warnings.length} warning(s).`);
}

export function run(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error("usage: node scripts/validateLayoutPrimitive.mjs <library-or-candidate.json>");
  }
  const input = loadLayoutInput(argv[0]);
  const report = validateLayouts(input.layouts, validationContext(input));
  printReport(input, report);
  return report;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const report = run();
    if (report.verdict === "fail") process.exitCode = 1;
  } catch (error) {
    console.error(`[validateLayoutPrimitive] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
