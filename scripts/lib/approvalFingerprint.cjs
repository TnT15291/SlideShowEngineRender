const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function fingerprintFiles(root, files) {
  const rows = [...new Set(files)].sort().map((file) => {
    const normalized = file.replace(/\\/g, "/");
    const content = fs.readFileSync(path.resolve(root, normalized));
    return { path: normalized, sha256: crypto.createHash("sha256").update(content).digest("hex") };
  });
  return { algorithm: "sha256", files: rows,
    digest: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
}

function validateFingerprint(root, expected) {
  if (!expected?.files?.length || !expected.digest) return { ok: false, reason: "Preview has no content fingerprint." };
  try {
    const actual = fingerprintFiles(root, expected.files.map((row) => row.path));
    return actual.digest === expected.digest ? { ok: true, actual }
      : { ok: false, reason: "Approved preview inputs changed after approval.", actual };
  } catch (error) {
    return { ok: false, reason: `Approved preview input is missing: ${error.message}` };
  }
}

module.exports = { fingerprintFiles, validateFingerprint };
