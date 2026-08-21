import fs from "node:fs";
import path from "node:path";

const natural = (left, right) => left.localeCompare(right, undefined, { numeric: true });

/**
 * Order files by the upload manifest when one is supplied. Files not represented
 * there (for CLI/imported projects) keep their natural filename order afterward.
 */
export function orderPhotoInputFiles(files, manifestPath = "") {
  const fallback = [...files].sort(natural);
  if (!manifestPath || !fs.existsSync(manifestPath)) return fallback;
  let assets;
  try {
    assets = JSON.parse(fs.readFileSync(manifestPath, "utf8")).assets;
  } catch {
    throw new Error(`Invalid upload manifest JSON: ${manifestPath}`);
  }
  if (!Array.isArray(assets)) throw new Error(`Invalid upload manifest: ${manifestPath}`);
  const position = new Map(
    assets
      .filter((asset) => asset?.kind === "photo" && typeof asset.storedName === "string" && Number.isInteger(asset.uploadIndex))
      .map((asset) => [path.basename(asset.storedName), asset.uploadIndex]),
  );
  return fallback.sort((left, right) => {
    const leftIndex = position.get(left);
    const rightIndex = position.get(right);
    if (leftIndex !== undefined || rightIndex !== undefined) return (leftIndex ?? Infinity) - (rightIndex ?? Infinity) || natural(left, right);
    return natural(left, right);
  });
}
