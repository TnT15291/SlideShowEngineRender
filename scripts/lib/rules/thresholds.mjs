// The rule layer's single source of thresholds.
//
// A number belongs here when two places must AGREE on it — a generator and the
// QA check that audits its output (the highlight window), or two QA layers
// sampling the same signal (frame brightness) — or when it defines what a rule
// in lib/rules/contract.mjs MEANS. A number does not belong here merely because
// it is a literal: thresholds with a single owning module keep living there
// (MIN_SCENE/MAX_SCENE in lib/pacing.mjs, MAX_SLIDE_SEC derived from the schema
// in lib/directives.mjs, FULL_SONG_MAX_SEC_PER_PHOTO in lib/musicHighlight.mjs).

// --- rendered-frame brightness (ffmpeg signalstats, luma 0..255) -------------
// Verdicts on a SAMPLED FRAME of the rendered video, not on the timeline JSON.
export const FRAME_DARK_YAVG = 42;         // below: too_dark on a framed photo
export const FRAME_DARK_LENIENT_YAVG = 20; // montage/full-bleed run darker by design (grain, letterbox, scrim)
export const FRAME_BRIGHT_YAVG = 224;      // above: too_bright
export const FRAME_FLAT_RANGE = 38;        // ymax-ymin below: flat_or_empty

// How the frame_brightness repair corrects an exposure it has measured. It aims PAST the
// threshold by a margin, so a frame that lands exactly on the line does not come straight
// back on the next pass — the fix-once rule means there is no second attempt.
//
// The repair used to swap the scene's hero photograph instead, which could not work and
// mostly never ran: it needed a layer carrying `motion` (montages and single-photo slides
// have no layers at all, and a card's photo need not move) AND an UNUSED replacement of the
// same orientation — but a Lite film spends every photograph in the album, so that was
// false for all of them. Exposure is also the proportionate answer: a frame half a stop hot
// is the right photograph badly exposed, and swapping it discards an assignment the solver
// computed against duplicate and adjacency constraints.
export const EXPOSURE_REPAIR_MARGIN = 12;  // YAVG units to aim inside the threshold
export const EXPOSURE_REPAIR_MAX = 0.25;   // largest |brightness| shift; beyond this the photo is wrong, not its exposure
// Largest contrast multiplier for a flat frame. Deliberately short of what would always
// clear FRAME_FLAT_RANGE: a frame measuring 14 would need 3.6x to reach 50, which does not
// rescue a photograph, it shreds it. So a badly flat frame is lifted as far as is decent and
// then stays flagged for a person — which is the honest answer, because a frame with almost
// no tonal range is usually fog or a blank wall rather than a gradeable photograph.
export const CONTRAST_REPAIR_MAX = 1.6;
export const BLACK_FRAME_YAVG = 4;         // below: not "dark", genuinely black — a broken render

// --- music edit ---------------------------------------------------------------
// The cutter (lib/musicHighlight.mjs) picks a window inside these bounds and the
// QA music_edit check re-verifies the same bounds; they must never diverge.
export const HIGHLIGHT_MIN_SEC = 60;
export const HIGHLIGHT_MAX_SEC = 105;
export const PHRASE_SNAP_TOLERANCE_SEC = 0.05; // an edit boundary further than this from a phrase is off_phrase

// --- pacing / hero proxies (see qaProxy.mjs header for the proxy argument) ----
export const PACING_TOLERANCE = 0.25; // relative deviation from the energy-implied duration before a flag
export const HERO_SWAP_MARGIN = 0.15; // a replacement must beat the seated hero's score by this much
// A hero slot is "weak" when it sits in the bottom slice of the album, not merely below
// average. The check used to compare against the pool MEDIAN, which half of any album
// fails by construction: on a real 83-photo job it flagged 5 of 7 hero slots and made
// `verdict=review` the normal outcome of a clean Lite run. A percentile keeps the check
// pointed at the frames that genuinely drag a film down.
export const HERO_WEAK_PERCENTILE = 0.25;

// --- tier-1 quality gate -------------------------------------------------------
export const TEXT_SAFE_MARGIN = 0.05;   // title-safe margin as a fraction of each canvas edge
export const MAX_LAYOUT_RUN = 3;        // identical effect:layout states tolerated in a row
export const MIN_CLOSING_SECONDS = 2.5; // a closing card shorter than this reads as a glitch

/**
 * Title-safe insets in pixels, per axis.
 *
 * There used to be two rules. tier1QualityGate — the gate that actually blocks a customer
 * job — measured 5% of each edge, while the library validator and the look resolver used a
 * flat 70px. On a 1920x1080 canvas that is 96px horizontally and 54px vertically, so the
 * flat margin was 26px too permissive across the frame and 16px too strict down it. The gap
 * let a heading overhang the right edge by 6px through the validator and fail only later, in
 * the test suite. One definition now, and it is the one the runtime gate enforces.
 */
export function textSafeInsets(canvas, fraction = TEXT_SAFE_MARGIN) {
  const width = canvas?.width ?? 1920;
  const height = canvas?.height ?? 1080;
  return { x: width * fraction, y: height * fraction };
}

/**
 * How tall each cinematic bar is, or 0 when this grade draws none. Restates the arithmetic
 * in src/buildColorFilters.ts `letterboxBarHeight` because that side is TypeScript the
 * script layer cannot import. The two are pinned to the same numbers from both ends:
 * test/composed-letterbox.test.mjs asserts 138px here, src/preflightTimeline.test.ts asserts
 * the renderer's 138px there. Either one drifting turns a suite red.
 */
export function letterboxBarHeight(color, canvas) {
  if (!color?.letterbox) return 0;
  const width = canvas?.width ?? 1920;
  const height = canvas?.height ?? 1080;
  const aspect = typeof color.letterbox === "number" ? color.letterbox : 2.39;
  return Math.max(0, Math.round((height - width / aspect) / 2));
}

/**
 * Would this layout put words where a cinematic bar will cover them?
 *
 * Judged on what the renderer is CERTAIN to draw, not on the slot box. drawtext anchors the
 * block at the slot's y and never wraps by itself, so the top of the first line is always
 * `slot.y` and the bottom of that line is always `slot.y + sizePx` — both known before a
 * single word is written, which is what lets the composer avoid these layouts while the
 * cards are still empty. A slot whose BOX dips into a bar while its line of text sits well
 * above it is how several shipping cards are authored (cinematic-film-01's full_bleed_quote
 * clears by 32px), and excluding those would cost the film compositions for nothing.
 */
export function textSlotsClearLetterbox(layout, bar, canvas) {
  if (bar <= 0) return true;
  const height = canvas?.height ?? 1080;
  return (layout?.textSlots ?? []).every((slot) =>
    slot.y >= bar && slot.y + (slot.sizePx ?? 0) <= height - bar);
}

// A 26px date or caption is intentionally quieter than a 26px paragraph. `fontRole`
// chooses the typeface; the semantic `role` decides how large the words must be to do
// their job. Keep this shared by the primitive validator and the all-recipe contract.
export const TEXT_SIZE_MIN_BY_ROLE = Object.freeze({
  body: 32,
  caption: 26,
  display: 64,
  eyebrow: 28,
  heading: 58,
  hero_numeral: 120,
  names: 96,
  subheading: 26,
  tile_label: 40,
});

export function minimumTextSize(slot = {}) {
  if (TEXT_SIZE_MIN_BY_ROLE[slot.role]) return TEXT_SIZE_MIN_BY_ROLE[slot.role];
  if (slot.fontRole === "body") return TEXT_SIZE_MIN_BY_ROLE.body;
  if (slot.fontRole === "script_accent") return TEXT_SIZE_MIN_BY_ROLE.display;
  return TEXT_SIZE_MIN_BY_ROLE.heading;
}

// --- photo coverage ---------------------------------------------------------------
// How much of the album the finished film is allowed to leave on the floor.
//
// The floor is a BACKSTOP, not the main check. A plan may legitimately show fewer
// photographs than were selected — the composer solves scene demand against the track's
// length, and 81 slots for 82 photos is a fair fit, not a defect. What is never fair is a
// photograph the plan HAD and something took away, which is why the directive shortfall
// below is a flag in its own right and needs no threshold at all.
//
// EVIDENCE, stated plainly because it is thin: only two jobs in projects/ still carry a
// photo-assignment report (100% and 98.8% coverage), and the run this rule was written for
// shipped 80.5%. 0.85 sits clear of both healthy jobs and below the broken one. Re-measure
// it once a real corpus of reports exists rather than treating it as settled.
//
// APPLIED AS AN ALLOWANCE IN PHOTOGRAPHS, NOT AS A RATIO — see qaProxy.mjs. The consumer
// converts this to `max(1, floor(selected * (1 - FLOOR)))` unplaced pictures, because a
// ratio cannot express "a fair fit at the margin" once the margin is smaller than one
// photograph: 15% of a four-photo album is 0.6, an allowance of none, and the rule failed
// films that had honestly fit every picture the music had room for. The conversion is
// exact for albums of seven photographs or more.
export const PHOTO_COVERAGE_FLOOR = 0.85;

// --- crop / focus ----------------------------------------------------------------
export const FOCUS_SAFE_MIN = 0.08;      // focusX/focusY outside [MIN, MAX] crops into the bleed
export const FOCUS_SAFE_MAX = 0.92;
export const FACE_CONTAIN_MARGIN = 0.015; // slack when testing that a face box fits the visible crop
// A face box covering this much of an axis carries no position along it. analyzePhotos falls
// back to the bounding box of all skin-coloured pixels when the detector finds nothing
// (faceDetection: "skin_estimate_fallback", confidence 0.35), and on a wide warm-lit shot that
// box is the whole frame — an unsatisfiable containment constraint rather than a real face.
export const DEGENERATE_FACE_AXIS = 0.9;

/**
 * The confidence below which a "face" may not veto a crop.
 *
 * This is not a tuning knob, it is a category boundary. The detector's own scoreThreshold
 * is 0.5 (lib/yunetFaceDetector.mjs), so no real detection is ever below it; 0.35 is the
 * exact value analyzePhotos stamps on the skin-colour bounding box it substitutes when the
 * detector found NOTHING at all (`faceDetection: "skin_estimate_fallback"`).
 *
 * DEGENERATE_FACE_AXIS above already refuses boxes that span ≥90% of an axis, but a skin
 * blob does not have to be that extreme to do damage. Measured over one 83-photo album:
 * the 9 sub-0.5 boxes average 0.76 of the frame HEIGHT against 0.10 for the 189 real
 * detections — 7.6x — and all 7 boxes taller than half the frame are sub-0.5. At 0.73-0.80
 * tall they cleared the 0.9 axis guard and were enforced as uncroppable, so the crop check
 * gave up on cropping and swapped `cover` for `contain`, rendering the photograph at 54-67%
 * of its slot with the page showing through the rest.
 *
 * A low-confidence box is still a fine FOCUS hint — it just cannot forbid a crop.
 */
export const FACE_CONFIDENCE_MIN = 0.5;

// --- audio / video ---------------------------------------------------------------
export const AUDIO_DRIFT_MAX_SEC = 0.25; // muxed audio and video stream durations may differ by this much

// --- story-template authoring rules (lib/rules/templateRules.mjs) ---------------
// Authoring-time floors for the recipe files themselves, born from watching real
// renders: thin palettes loop, tiny slots read as empty frames, black canvases read
// as "nothing around the photo", muted half-text layouts leave half a slide blank.
export const TEMPLATE_MIN_SCENES = 8;                 // fewer scenes = the solver repeats the palette sooner
export const TEMPLATE_MIN_DISTINCT_LOOKS = 6;         // distinct effect/layout/hybrid states across the film
export const TEMPLATE_MIN_REPEATABLE_SCENES = 2;      // body scenes that carry authored repeat variants
export const TEMPLATE_MAX_PHOTOLESS_SCENES = 2;       // video interludes; photoless repeats are the same clip again
export const SLOT_AREA_FLOOR = 0.08;                  // per-photo-slot area fraction, layouts with <6 slots
export const SLOT_AREA_FLOOR_GRID = 0.05;             // ...with >=6 slots (grid walls)
export const SCENE_PHOTO_COVERAGE_MIN = 0.35;         // photo area per layer_scene without a full-bleed background
export const SCENE_PHOTO_COVERAGE_MIN_TEXTED = 0.25;  // textRequired layouts: the copy carries the rest
export const CANVAS_BG_MIN_LUMA = 20;                 // params.background may be dark, but never near-black (0..255)

// --- composed-film floors (lib/rules/composedFilm.mjs) ---------------------------
// A hand-authored recipe passes through a person AND through the rules above. A composed
// storyboard has no person, so the numbers a person would have noticed have to be stated.
// These are the shot list's own `fit.variety` — already computed by lib/storyboard.mjs and,
// until now, only printed. Calibrated 2026-08-08 against three real composed films:
// premium 11 effects / 5 sizes, lite 8 / 6 and 8 / 5. The floors sit under the worst of
// those, so they catch a COLLAPSE (the old composer shipped one effect and three layouts),
// not ordinary variation between jobs.
export const COMPOSED_MIN_DISTINCT_EFFECTS = 5;   // distinct scene effects across the film
export const COMPOSED_MIN_SCENE_SIZES = 3;        // distinct photos-per-scene counts: the film's rhythm
export const COMPOSED_MIN_TYPEFACES = 3;          // display + body + script, resolved the renderer's way
