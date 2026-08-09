/** Globally assign photos to slots. Hard/scarce slots are solved first, while
 * output remains keyed by story order so rendering is deterministic. */
import { scoreForRole } from "./tier1Editorial.mjs";
import { neighborRepetitionPenalty } from "./diversityPlanner.mjs";

export function assignPhotos({ photos, requests, reserved = [], sequenceMode = "editorial", maxReuse = 1, allowOrientationFallback = true }) {
  if (!Number.isInteger(maxReuse) || maxReuse < 1) throw new Error(`maxReuse must be an integer >= 1, got ${maxReuse}`);
  const used = new Set(reserved);
  const useCounts = new Map(reserved.map((file) => [file, 1]));
  const groupOf = (file) => photos.find((p) => p.file === file)?.duplicateGroup;
  const usedGroups = new Set(reserved.map(groupOf).filter(Boolean));
  const assignments = new Map();
  const requestByKey = new Map(requests.map((r) => [r.key, r]));
  const quality = (p, r) => scoreForRole(p, r.role) * 10 + (p.sharpness ?? 0) * 0.02;
  const availableFor = (r, { reuse = false, picked = [], neighborFiles = new Set(), neighborGroups = new Set() } = {}) => {
    const pickedFiles = new Set(picked.map((photo) => photo.file));
    const pickedGroups = new Set(picked.map((photo) => photo.duplicateGroup).filter(Boolean));
    const available = photos.filter((p) => (reuse ? (useCounts.get(p.file) || 0) < maxReuse : !used.has(p.file)) &&
      !pickedFiles.has(p.file) && (!p.duplicateGroup || !pickedGroups.has(p.duplicateGroup)) &&
      (!r.orient || r.orient === "any" || p.orient === r.orient));
    const distinct = reuse ? available : available.filter((p) => !p.duplicateGroup || !usedGroups.has(p.duplicateGroup));
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
      const neighborFiles = new Set([...assignments.entries()].flatMap(([key, files]) => {
        const other = requestByKey.get(key);
        return other && Math.abs(other.order - request.order) <= 1 ? files : [];
      }));
      const neighborGroups = new Set([...assignments.entries()].flatMap(([key, files]) => {
        const other = requestByKey.get(key);
        if (!other || Math.abs(other.order - request.order) > 1) return [];
        return files.map((file) => photos.find((p) => p.file === file)?.duplicateGroup).filter(Boolean);
      }));
      let available = availableFor(request, { picked, neighborFiles, neighborGroups });
      if (!available.length && allowOrientationFallback && request.orient && request.orient !== "any") {
        available = availableFor({ ...request, orient: "any" }, { picked, neighborFiles, neighborGroups });
      }
      if (!available.length && maxReuse > 1) {
        available = availableFor(request, { reuse: true, picked, neighborFiles, neighborGroups });
        if (!available.length && allowOrientationFallback && request.orient && request.orient !== "any") {
          available = availableFor({ ...request, orient: "any" }, { reuse: true, picked, neighborFiles, neighborGroups });
        }
      }
      const neighborSafe = available.filter((photo) => !neighborFiles.has(photo.file)
        && (!photo.duplicateGroup || !neighborGroups.has(photo.duplicateGroup)));
      if (neighborSafe.length) available = neighborSafe;
      const nonDuplicate = available.filter((p) =>
        p.file !== previous?.file && (!previous?.duplicateGroup || p.duplicateGroup !== previous.duplicateGroup)
      );
      const candidates = (nonDuplicate.length ? nonDuplicate : available).sort((a, b) => {
        if (sequenceMode === "chronological") return (a.uploadIndex ?? Infinity) - (b.uploadIndex ?? Infinity);
        const diversity = (p) => (previous?.duplicateGroup && p.duplicateGroup === previous.duplicateGroup) ||
          (p.duplicateGroup && neighborGroups.has(p.duplicateGroup)) ? -20 : 0;
        const dark = (p) => (p.meanLuma ?? 128) < 75 ? -5 : 0;
        const required = (p) => request.required === p.file ? 10000 : 0;
        const preferred = (p) => request.preferred === p.file || request.preferred?.includes?.(p.file) ? 20 : 0;
        const leastUsed = (p) => -(useCounts.get(p.file) || 0) * 30;
        const sequence = (p) => request.allowSequence ? 0 : neighborRepetitionPenalty(p, request, assignments, requestByKey, photos);
        const score = (quality(b, request) + diversity(b) + sequence(b) + dark(b) + preferred(b) + required(b) + leastUsed(b)) -
          (quality(a, request) + diversity(a) + sequence(a) + dark(a) + preferred(a) + required(a) + leastUsed(a));
        return score || a.file.localeCompare(b.file, undefined, { numeric: true });
      });
      const chosen = candidates[0];
      if (!chosen) break;
      used.add(chosen.file);
      useCounts.set(chosen.file, (useCounts.get(chosen.file) || 0) + 1);
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
  const finalUseCounts = new Map(reserved.map((file) => [file, 1]));
  const reuses = [];
  for (const request of [...requests].sort((a, b) => a.order - b.order)) {
    for (const file of assignments.get(request.key) || []) {
      const before = finalUseCounts.get(file) || 0;
      finalUseCounts.set(file, before + 1);
      if (before > 0) {
        const reason = request.required === file ? "must_use"
          : request.preferred === file || request.preferred?.includes?.(file) ? "story_match"
            : photos.length < requests.reduce((sum, item) => sum + item.count, 0) ? "small_album_fallback" : "pool_exhausted";
        reuses.push({ requestKey: request.key, sceneId: request.sceneId, file, use: before + 1, reason });
      }
    }
  }
  const adjacentCollisions = adjacentDuplicateCount();
  return {
    assignments,
    used,
    useCounts: finalUseCounts,
    reuses,
    adjacentCollisions,
    unfilled: requests.filter((r) => (assignments.get(r.key)?.length || 0) < r.count),
  };
}
