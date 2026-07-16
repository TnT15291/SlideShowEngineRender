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

// --- tier-1 quality gate -------------------------------------------------------
export const TEXT_SAFE_MARGIN = 0.05;   // title-safe margin as a fraction of each canvas edge
export const MAX_LAYOUT_RUN = 3;        // identical effect:layout states tolerated in a row
export const MIN_CLOSING_SECONDS = 2.5; // a closing card shorter than this reads as a glitch

// --- crop / focus ----------------------------------------------------------------
export const FOCUS_SAFE_MIN = 0.08;      // focusX/focusY outside [MIN, MAX] crops into the bleed
export const FOCUS_SAFE_MAX = 0.92;
export const FACE_CONTAIN_MARGIN = 0.015; // slack when testing that a face box fits the visible crop

// --- audio / video ---------------------------------------------------------------
export const AUDIO_DRIFT_MAX_SEC = 0.25; // muxed audio and video stream durations may differ by this much
