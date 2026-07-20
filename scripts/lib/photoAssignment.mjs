/** Globally assign photos to slots. Hard/scarce slots are solved first, while
 * output remains keyed by story order so rendering is deterministic. */
import { scoreForRole } from "./tier1Editorial.mjs";
import { neighborRepetitionPenalty } from "./diversityPlanner.mjs";

export function assignPhotos({ photos, requests, reserved = [], sequenceMode = "editorial" }) {
  const used = new Set(reserved);
  const groupOf = (file) => photos.find((p) => p.file === file)?.duplicateGroup;
  const usedGroups = new Set(reserved.map(groupOf).filter(Boolean));
  const assignments = new Map();
  const requestByKey = new Map(requests.map((r) => [r.key, r]));
  const quality = (p, r) => scoreForRole(p, r.role) * 10 + (p.sharpness ?? 0) * 0.02;
  const availableFor = (r) => {
    const available = photos.filter((p) => !used.has(p.file) &&
      (!r.orient || r.orient === "any" || p.orient === r.orient));
    const distinct = available.filter((p) => !p.duplicateGroup || !usedGroups.has(p.duplicateGroup));
    return distinct.length ? distinct : available;
  };
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
      const available = availableFor(request);
      const nonDuplicate = available.filter((p) =>
        (!previous?.duplicateGroup || p.duplicateGroup !== previous.duplicateGroup) &&
        (!p.duplicateGroup || !neighborGroups.has(p.duplicateGroup))
      );
      const candidates = (nonDuplicate.length ? nonDuplicate : available).sort((a, b) => {
        if (sequenceMode === "chronological") return (a.uploadIndex ?? Infinity) - (b.uploadIndex ?? Infinity);
        const diversity = (p) => (previous?.duplicateGroup && p.duplicateGroup === previous.duplicateGroup) ||
          (p.duplicateGroup && neighborGroups.has(p.duplicateGroup)) ? -20 : 0;
        const dark = (p) => (p.meanLuma ?? 128) < 75 ? -5 : 0;
        const preferred = (p) => request.preferred === p.file ? 10000 : 0;
        const sequence = (p) => request.allowSequence ? 0 : neighborRepetitionPenalty(p, request, assignments, requestByKey, photos);
        const score = (quality(b, request) + diversity(b) + sequence(b) + dark(b) + preferred(b)) -
          (quality(a, request) + diversity(a) + sequence(a) + dark(a) + preferred(a));
        return score || a.file.localeCompare(b.file, undefined, { numeric: true });
      });
      const chosen = candidates[0] || photos.find((p) => !used.has(p.file));
      if (!chosen) break;
      used.add(chosen.file);
      if (chosen.duplicateGroup) usedGroups.add(chosen.duplicateGroup);
      picked.push(chosen);
    }
    assignments.set(request.key, picked.map((p) => p.file));
  }

  const byFile = new Map(photos.map((p) => [p.file, p]));
  const accepts = (request, file) => {
    const photo = byFile.get(file);
    return photo && (!request.orient || request.orient === "any" || photo.orient === request.orient);
  };
  const adjacentDuplicateCount = () => {
    const groupsByOrder = new Map();
    for (const [key, files] of assignments) {
      const order = requestByKey.get(key)?.order;
      if (!Number.isFinite(order)) continue;
      const groups = groupsByOrder.get(order) || new Set();
      for (const file of files) {
        const group = byFile.get(file)?.duplicateGroup;
        if (group) groups.add(group);
      }
      groupsByOrder.set(order, groups);
    }
    let count = 0;
    for (const [order, groups] of groupsByOrder) {
      const next = groupsByOrder.get(order + 1);
      if (next) for (const group of groups) if (next.has(group)) count++;
    }
    return count;
  };

  // Scarce/hero slots are assigned before story order, so a later hard slot may already
  // own the only obvious non-duplicate when its neighbour is filled. Repair that global
  // ordering artifact with orientation-safe swaps; never weaken a slot constraint.
  let collisions = adjacentDuplicateCount();
  for (let pass = 0; collisions && pass < assignments.size; pass++) {
    let improved = false;
    const entries = [...assignments.entries()];
    outer: for (let a = 0; a < entries.length; a++) for (let ai = 0; ai < entries[a][1].length; ai++) {
      const [aKey, aFiles] = entries[a], aRequest = requestByKey.get(aKey);
      for (let b = a + 1; b < entries.length; b++) for (let bi = 0; bi < entries[b][1].length; bi++) {
        const [bKey, bFiles] = entries[b], bRequest = requestByKey.get(bKey);
        const aFile = aFiles[ai], bFile = bFiles[bi];
        if (!accepts(aRequest, bFile) || !accepts(bRequest, aFile)) continue;
        aFiles[ai] = bFile; bFiles[bi] = aFile;
        const after = adjacentDuplicateCount();
        if (after < collisions) {
          collisions = after; improved = true; break outer;
        }
        aFiles[ai] = aFile; bFiles[bi] = bFile;
      }
    }
    if (!improved) break;
  }
  return { assignments, used, unfilled: requests.filter((r) => (assignments.get(r.key)?.length || 0) < r.count) };
}
