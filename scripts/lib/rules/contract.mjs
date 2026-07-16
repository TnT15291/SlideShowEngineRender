// The shared finding contract and rule registry.
//
// Every QA emitter — qaProxy.mjs, qaClip.mjs, lib/tier1QualityGate.mjs — already
// reports the same shape, and this file makes that shape a stated contract
// rather than a coincidence:
//
//   { id, check, flags: [...], detail, fix?: { kind, ... } }
//
//   id     scene id the finding is about ("project"/"audio"/"music_edit" for
//          film-wide findings)
//   check  the rule id — the key into RULES below and into lib/rules/policy.mjs
//   flags  machine-readable failure modes within the rule
//   fix    a deterministic repair PROPOSAL; only qaLoop.mjs ever applies one
//
// The registry classifies each rule by the domain its EVIDENCE comes from — a
// timeline JSON cannot prove a frame rendered dark, and a sampled frame cannot
// prove a must-use photo is missing — and names the only repair kinds allowed
// to touch it. Same argument as lib/engineCapabilities.mjs: emitting a check
// that is not declared here is a defect (test/rules.test.mjs scans the emitters
// for it), so adding a rule is one registry entry, not an archaeology dig.

export const SCOPES = [
  "timeline",       // provable from the timeline JSON alone
  "asset",          // needs photo analysis (photos.json) joined to the timeline
  "editorial",      // repetition, pacing, hero strength — taste made measurable
  "rendered-frame", // needs frames sampled from the actual rendered video
  "audio-video",    // needs the muxed output, or the music analysis + edit decision
];

// Every repair kind qaLoop.mjs knows how to execute. A rule (or a policy row)
// may only reference these.
export const REPAIR_KINDS = ["set_duration", "swap_hero", "set_focus", "fit_text"];

export const RULES = {
  // -- timeline -----------------------------------------------------------------
  must_use_coverage: { scope: "timeline", repairs: [] }, // a customer lock; nothing may auto-substitute for it
  text_safe_area:    { scope: "timeline", repairs: [] },
  text_overflow:     { scope: "timeline", repairs: ["fit_text"] },
  caption_integrity: { scope: "timeline", repairs: [] }, // mojibake/tokens/dupes need a human or a re-generate
  closing_card:      { scope: "timeline", repairs: [] },

  // -- asset ---------------------------------------------------------------------
  crop:              { scope: "asset", repairs: ["set_focus"] },

  // -- editorial -------------------------------------------------------------------
  duplicate_photo:   { scope: "editorial", repairs: [] },
  layout_repetition: { scope: "editorial", repairs: [] },
  overlay_repetition:{ scope: "editorial", repairs: [] },
  pacing:            { scope: "editorial", repairs: ["set_duration"] },
  hero:              { scope: "editorial", repairs: ["swap_hero"] },

  // -- rendered-frame ---------------------------------------------------------------
  frame_brightness:  { scope: "rendered-frame", repairs: ["swap_hero"] },
  black_frame:       { scope: "rendered-frame", repairs: [] }, // a black frame means the render broke, not the photo

  // -- audio-video ------------------------------------------------------------------
  music_edit:        { scope: "audio-video", repairs: [] },
  audio_drift:       { scope: "audio-video", repairs: [] },
};

export const isKnownRule = (check) => Object.hasOwn(RULES, check);
