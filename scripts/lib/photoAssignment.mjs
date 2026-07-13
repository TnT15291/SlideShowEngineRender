/** Globally assign photos to slots. Hard/scarce slots are solved first, while
 * output remains keyed by story order so rendering is deterministic. */
import { scoreForRole } from "./tier1Editorial.mjs";
import { neighborRepetitionPenalty } from "./diversityPlanner.mjs";

export function assignPhotos({ photos, requests, reserved = [] }) {
  const used = new Set(reserved);
  const assignments = new Map();
  const requestByKey = new Map(requests.map((r) => [r.key, r]));
  const quality = (p, r) => scoreForRole(p, r.role) * 10 + (p.sharpness ?? 0) * 0.02;
  const availableFor = (r) => photos.filter((p) => !used.has(p.file) &&
    (!r.orient || r.orient === "any" || p.orient === r.orient));
  const hardness = (r) => {
    const supply = availableFor(r).length;
    return (r.hero ? 10000 : 0) + (r.orient && r.orient !== "any" ? 5000 : 0) + r.count * 10 - supply;
  };
  const ordered = [...requests].sort((a, b) => hardness(b) - hardness(a) || a.order - b.order);

  for (const request of ordered) {
    const picked = [];
    for (let i = 0; i < request.count; i++) {
      const previous = picked.at(-1);
      const neighborGroups = new Set([...assignments.entries()].flatMap(([key, files]) => {
        const other = requestByKey.get(key);
        if (!other || Math.abs(other.order - request.order) > 1) return [];
        return files.map((file) => photos.find((p) => p.file === file)?.duplicateGroup).filter(Boolean);
      }));
      const candidates = availableFor(request).sort((a, b) => {
        const diversity = (p) => (previous?.duplicateGroup && p.duplicateGroup === previous.duplicateGroup) ||
          (p.duplicateGroup && neighborGroups.has(p.duplicateGroup)) ? -20 : 0;
        const dark = (p) => (p.meanLuma ?? 128) < 75 ? -5 : 0;
        const preferred = (p) => request.preferred === p.file ? 10000 : 0;
        const sequence = (p) => request.allowSequence ? 0 : neighborRepetitionPenalty(p, request, assignments, requestByKey, photos);
        return (quality(b, request) + diversity(b) + sequence(b) + dark(b) + preferred(b)) -
          (quality(a, request) + diversity(a) + sequence(a) + dark(a) + preferred(a));
      });
      const chosen = candidates[0] || photos.find((p) => !used.has(p.file));
      if (!chosen) break;
      used.add(chosen.file); picked.push(chosen);
    }
    assignments.set(request.key, picked.map((p) => p.file));
  }
  return { assignments, used, unfilled: requests.filter((r) => (assignments.get(r.key)?.length || 0) < r.count) };
}
