// WHAT THIS FILE EXISTS TO CATCH.
//
// test/lite-style-profiles.test.mjs proves the three Lite profiles are distinct AS
// CONFIGURATION: different themes, different effect lists, three display faces. It reads
// the table. It never reads a film.
//
// That is exactly the gap this repo keeps falling into — a director's decisions computed
// and then never read, a `defaults.fonts` that silently outranks the theme it was supposed
// to defer to. A profile table can be perfectly distinct while the pipeline downstream
// ignores it, and every existing test would still be green.
//
// So this module fingerprints the TIMELINE a profile actually produced, from one shared
// album, and compares the three against each other. If choosing `editorial_clean` over
// `warm_film_story` stops changing the film, the distinctness matrix collapses and the
// gallery test fails.
import fs from "node:fs";
import path from "node:path";

import { buildLiteQualityReport, netDuration } from "./liteQualityReport.mjs";

// Vietnamese is the language this product ships in, and a font that renders it as boxes
// is invisible to every other gate — the render succeeds, the QA proxy sees text, and the
// customer gets a title full of tofu. Google's `subsets: ["vietnamese"]` metadata does not
// agree with what is in the TTF, so this probes the cmap directly.
//
// Covers the marks that break first: horn (ơ ư), breve (ă), circumflex stacks (ấ ề ổ),
// tone marks under (ạ ệ ọ), and đ.
export const VIETNAMESE_PROBE =
  "ăâđêôơưĂÂĐÊÔƠƯ"
  + "áàảãạắằẳẵặấầẩẫậ"
  + "éèẻẽẹếềểễệ"
  + "íìỉĩị"
  + "óòỏõọốồổỗộớờởỡợ"
  + "úùủũụứừửữự"
  + "ýỳỷỹỵ"
  + "ÁÀẢÃẠẮẰẲẴẶẤẦẨẪẬÉÈẺẼẸẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌỐỒỔỖỘỚỜỞỠỢÚÙỦŨỤỨỪỬỮỰÝỲỶỸỴ";

function sfntTables(buffer) {
  // A .ttc collection points at its first font; everything else starts at 0.
  const offset = buffer.readUInt32BE(0) === 0x74746366 ? buffer.readUInt32BE(12) : 0;
  const count = buffer.readUInt16BE(offset + 4);
  const tables = {};
  for (let i = 0; i < count; i += 1) {
    const record = offset + 12 + i * 16;
    tables[buffer.toString("ascii", record, record + 4)] = {
      offset: buffer.readUInt32BE(record + 8),
      length: buffer.readUInt32BE(record + 12),
    };
  }
  return tables;
}

/** Pick the widest Unicode subtable: (3,10) format 12 first, then (3,1)/(0,x) format 4. */
function pickCmapSubtable(buffer, cmapOffset) {
  const count = buffer.readUInt16BE(cmapOffset + 2);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const record = cmapOffset + 4 + i * 8;
    const platform = buffer.readUInt16BE(record);
    const encoding = buffer.readUInt16BE(record + 2);
    const subtable = cmapOffset + buffer.readUInt32BE(record + 4);
    const format = buffer.readUInt16BE(subtable);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const rank = format === 12 ? 2 : format === 4 ? 1 : 0;
    if (rank && (!best || rank > best.rank)) best = { subtable, format, rank };
  }
  return best;
}

function glyphForFormat4(buffer, subtable, codepoint) {
  if (codepoint > 0xffff) return 0;
  const segCountX2 = buffer.readUInt16BE(subtable + 6);
  const endCodes = subtable + 14;
  const startCodes = endCodes + segCountX2 + 2;
  const idDeltas = startCodes + segCountX2;
  const idRangeOffsets = idDeltas + segCountX2;
  for (let i = 0; i < segCountX2; i += 2) {
    if (buffer.readUInt16BE(endCodes + i) < codepoint) continue;
    const start = buffer.readUInt16BE(startCodes + i);
    if (start > codepoint) return 0;
    const delta = buffer.readInt16BE(idDeltas + i);
    const rangeOffset = buffer.readUInt16BE(idRangeOffsets + i);
    if (rangeOffset === 0) return (codepoint + delta) & 0xffff;
    const glyphAddress = idRangeOffsets + i + rangeOffset + (codepoint - start) * 2;
    if (glyphAddress + 1 >= buffer.length) return 0;
    const glyph = buffer.readUInt16BE(glyphAddress);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  return 0;
}

function glyphForFormat12(buffer, subtable, codepoint) {
  const groups = buffer.readUInt32BE(subtable + 12);
  for (let i = 0; i < groups; i += 1) {
    const group = subtable + 16 + i * 12;
    const start = buffer.readUInt32BE(group);
    const end = buffer.readUInt32BE(group + 4);
    if (codepoint < start) return 0;
    if (codepoint > end) continue;
    return buffer.readUInt32BE(group + 8) + (codepoint - start);
  }
  return 0;
}

/**
 * Which characters of `probe` the font has no glyph for.
 * Returns `{ missing, checked, readable }`; `readable:false` means the file could not be
 * parsed at all, which is a louder problem than a missing mark and must not read as "clean".
 */
export function fontCodepointCoverage(fontPath, probe = VIETNAMESE_PROBE) {
  let buffer;
  try {
    buffer = fs.readFileSync(fontPath);
  } catch {
    return { missing: [], checked: 0, readable: false, reason: "unreadable" };
  }
  let subtable;
  try {
    const cmap = sfntTables(buffer).cmap;
    if (!cmap) return { missing: [], checked: 0, readable: false, reason: "no cmap table" };
    subtable = pickCmapSubtable(buffer, cmap.offset);
    if (!subtable) return { missing: [], checked: 0, readable: false, reason: "no unicode cmap subtable" };
  } catch (error) {
    return { missing: [], checked: 0, readable: false, reason: error.message };
  }
  const missing = [];
  const characters = [...new Set([...probe])];
  for (const character of characters) {
    const codepoint = character.codePointAt(0);
    const glyph = subtable.format === 12
      ? glyphForFormat12(buffer, subtable.subtable, codepoint)
      : glyphForFormat4(buffer, subtable.subtable, codepoint);
    if (!glyph) missing.push(character);
  }
  return { missing, checked: characters.length, readable: true };
}

const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort();

/** Every font path the timeline actually asks the renderer to load. */
export function fontsUsed(timeline) {
  const fonts = [];
  for (const slide of timeline.slides || []) {
    for (const layer of slide.layers || []) if (layer.font) fonts.push(layer.font);
    for (const caption of slide.captions || []) if (caption.font) fonts.push(caption.font);
  }
  return uniqueSorted(fonts);
}

/**
 * One profile's measurable signature, taken from the film it produced rather than the
 * table it was configured from.
 */
export function profileFingerprint({ profileId, provenance, timeline, storyboard, photos = [] }) {
  const slides = timeline.slides || [];
  const quality = buildLiteQualityReport({ timeline, photos });
  const fonts = fontsUsed(timeline);
  return {
    profile: profileId,
    provenance: provenance ?? null,
    libraryTheme: storyboard?.libraryTheme ?? null,
    scenes: slides.length,
    effects: uniqueSorted(slides.map((slide) => slide.effect)),
    transitions: uniqueSorted(slides.map((slide) => slide.transition?.type)),
    layouts: uniqueSorted((storyboard?.scenes || []).map((scene) => scene.layout)),
    looks: uniqueSorted((storyboard?.scenes || []).map((scene) => scene.look)),
    fonts,
    fontCoverage: Object.fromEntries(fonts.map((font) => {
      const { missing, checked, readable, reason } = fontCodepointCoverage(path.resolve(font));
      return [font, { missing, checked, readable, ...(reason ? { reason } : {}) }];
    })),
    grade: timeline.color ?? null,
    netDuration: netDuration(slides),
    drift: quality.music.drift,
    photos: {
      selected: quality.photos.selected,
      usedUnique: quality.photos.usedUnique,
      references: quality.photos.references,
      withinSceneDuplicates: quality.photos.withinSceneDuplicates.length,
      adjacentDuplicates: quality.photos.adjacentDuplicates.length,
    },
    text: {
      captions: quality.text.captions.length,
      estimatedOverflow: quality.text.estimatedOverflow,
      readingRateViolations: quality.text.readingRateViolations,
    },
  };
}

const jaccard = (left, right) => {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size && !b.size) return 1;
  const shared = [...a].filter((value) => b.has(value)).length;
  return +(shared / (a.size + b.size - shared)).toFixed(4);
};

/**
 * Pairwise comparison plus the findings a gate can act on.
 *
 * `overlap` is the mean Jaccard across effects/transitions/layouts — the three things a
 * viewer sees move. Two profiles sharing a theme, a display face or a whole vocabulary are
 * not "two profiles"; they are one profile listed twice.
 */
export function compareFingerprints(fingerprints) {
  const pairs = [];
  const findings = [];
  for (let i = 0; i < fingerprints.length; i += 1) {
    for (let j = i + 1; j < fingerprints.length; j += 1) {
      const a = fingerprints[i];
      const b = fingerprints[j];
      const effects = jaccard(a.effects, b.effects);
      const transitions = jaccard(a.transitions, b.transitions);
      const layouts = jaccard(a.layouts, b.layouts);
      const overlap = +((effects + transitions + layouts) / 3).toFixed(4);
      pairs.push({
        a: a.profile, b: b.profile, effects, transitions, layouts, overlap,
        sameTheme: a.libraryTheme === b.libraryTheme,
        sharedFonts: a.fonts.filter((font) => b.fonts.includes(font)),
      });
      if (a.libraryTheme === b.libraryTheme) {
        findings.push({ check: "profile_theme_collision", detail: `${a.profile} and ${b.profile} both resolve to ${a.libraryTheme}` });
      }
      if (effects === 1) {
        findings.push({ check: "profile_effect_collision", detail: `${a.profile} and ${b.profile} spend an identical effect vocabulary` });
      }
    }
  }
  for (const fingerprint of fingerprints) {
    for (const [font, coverage] of Object.entries(fingerprint.fontCoverage)) {
      if (!coverage.readable) {
        findings.push({ check: "font_unreadable", detail: `${fingerprint.profile}: ${font} (${coverage.reason})` });
      } else if (coverage.missing.length) {
        findings.push({ check: "font_vietnamese_gap", detail: `${fingerprint.profile}: ${font} is missing ${coverage.missing.join("")}` });
      }
    }
    if (fingerprint.photos.withinSceneDuplicates) {
      findings.push({ check: "within_scene_duplicate", detail: `${fingerprint.profile}: ${fingerprint.photos.withinSceneDuplicates} scene(s)` });
    }
    if (Math.abs(fingerprint.drift) > 0.1) {
      findings.push({ check: "music_drift", detail: `${fingerprint.profile}: drift ${fingerprint.drift}s exceeds 0.1s` });
    }
  }
  return { pairs, findings };
}
