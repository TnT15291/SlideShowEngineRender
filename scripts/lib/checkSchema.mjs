// Tiny JSON-Schema check harness for the analysis/*.json contracts, so each
// node's output can be verified without adding an ajv dependency (project deps
// stay `zod` only). It walks the subset of JSON Schema the contracts actually
// use: type, required, additionalProperties(false), enum, pattern, min/max,
// minLength/maxLength, minItems/maxItems, items, properties, $ref, $defs, oneOf.
//
// Usage: node scripts/lib/checkSchema.mjs <schema.json> <data.json>
//   exits 0 + "OK" on success, 1 + errors on failure.
import fs from "node:fs";
import path from "node:path";

export function validate(schema, data, root = schema) {
  const errors = [];
  walk(data, schema, "$", root, errors);
  return errors;
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((o, k) => (o == null ? o : o[k]), root);
}

function walk(data, schema, pathStr, root, errors) {
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (!target) { errors.push(`${pathStr}: unresolved $ref ${schema.$ref}`); return; }
    walk(data, target, pathStr, root, errors);
    // a node may carry $ref PLUS local constraints (e.g. layer variants); fall through
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((s) => validateSub(data, s, root).length === 0);
    if (matches.length !== 1) errors.push(`${pathStr}: matched ${matches.length} of oneOf (expected 1)`);
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    const ok = schema.anyOf.some((s) => validateSub(data, s, root).length === 0);
    if (!ok) errors.push(`${pathStr}: matched none of anyOf`);
    return;
  }
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${pathStr}: ${JSON.stringify(data)} not in enum [${schema.enum.join(", ")}]`);
    return;
  }
  if ("const" in schema && data !== schema.const) {
    errors.push(`${pathStr}: ${JSON.stringify(data)} !== const ${JSON.stringify(schema.const)}`);
    return;
  }
  const t = schema.type;
  if (t === "object" || schema.properties || schema.required) {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      errors.push(`${pathStr}: expected object, got ${Array.isArray(data) ? "array" : typeof data}`);
      return;
    }
    for (const req of schema.required || []) {
      if (!(req in data)) errors.push(`${pathStr}.${req}: missing required property`);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const k of Object.keys(data)) {
        if (!allowed.has(k)) errors.push(`${pathStr}.${k}: additional property not allowed`);
      }
    }
    for (const [k, sub] of Object.entries(schema.properties || {})) {
      if (k in data) walk(data[k], sub, `${pathStr}.${k}`, root, errors);
    }
    return;
  }
  if (t === "array") {
    if (!Array.isArray(data)) { errors.push(`${pathStr}: expected array, got ${typeof data}`); return; }
    if (schema.minItems != null && data.length < schema.minItems) errors.push(`${pathStr}: ${data.length} < minItems ${schema.minItems}`);
    if (schema.maxItems != null && data.length > schema.maxItems) errors.push(`${pathStr}: ${data.length} > maxItems ${schema.maxItems}`);
    if (schema.items) data.forEach((v, i) => walk(v, schema.items, `${pathStr}[${i}]`, root, errors));
    return;
  }
  if (t === "string") {
    if (typeof data !== "string") { errors.push(`${pathStr}: expected string, got ${typeof data}`); return; }
    if (schema.minLength != null && data.length < schema.minLength) errors.push(`${pathStr}: shorter than minLength ${schema.minLength}`);
    if (schema.maxLength != null && data.length > schema.maxLength) errors.push(`${pathStr}: longer than maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push(`${pathStr}: does not match pattern ${schema.pattern}`);
    return;
  }
  if (t === "integer" || t === "number") {
    if (typeof data !== "number" || (t === "integer" && !Number.isInteger(data))) {
      errors.push(`${pathStr}: expected ${t}, got ${typeof data}`); return;
    }
    if (schema.minimum != null && data < schema.minimum) errors.push(`${pathStr}: ${data} < minimum ${schema.minimum}`);
    if (schema.maximum != null && data > schema.maximum) errors.push(`${pathStr}: ${data} > maximum ${schema.maximum}`);
    if (schema.exclusiveMinimum != null && data <= schema.exclusiveMinimum) errors.push(`${pathStr}: ${data} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
    return;
  }
  if (t === "boolean" && typeof data !== "boolean") errors.push(`${pathStr}: expected boolean, got ${typeof data}`);
}

function validateSub(data, schema, root) {
  const errors = [];
  walk(data, schema, "$", root, errors);
  return errors;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("checkSchema.mjs")) {
  const [schemaPath, dataPath] = process.argv.slice(2);
  if (!schemaPath || !dataPath) {
    console.error("usage: node scripts/lib/checkSchema.mjs <schema.json> <data.json>");
    process.exit(2);
  }
  const schema = JSON.parse(fs.readFileSync(path.resolve(schemaPath), "utf8"));
  const data = JSON.parse(fs.readFileSync(path.resolve(dataPath), "utf8"));
  const errors = validate(schema, data);
  if (errors.length) {
    console.error(`FAIL ${dataPath} against ${path.basename(schemaPath)}:`);
    for (const e of errors.slice(0, 40)) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`OK ${dataPath} validates against ${path.basename(schemaPath)}`);
}
