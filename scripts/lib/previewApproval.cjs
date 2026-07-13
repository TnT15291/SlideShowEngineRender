const { validateFingerprint } = require("./approvalFingerprint.cjs");

function currentSelection(manifest, selection) {
  return selection?.previewGeneratedAt === manifest?.generatedAt ? selection : null;
}

function validateApprovedSelection(root, manifest, selection, projectManifest) {
  const current = currentSelection(manifest, selection);
  if (!current || current.status !== "approved") return { ok: false, reason: "Approve a preview direction before rendering." };
  if (current.recipeId !== projectManifest?.recipe) return { ok: false, reason: "The selected preview belongs to a different recipe." };
  return validateFingerprint(root, current.fingerprint);
}

module.exports = { currentSelection, validateApprovedSelection };
