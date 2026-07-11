// Shared DeepSeek text client for the creative-reasoning nodes (Phase B: Story
// Options, Creative Brief + Director Notes, Story Plan).
//
// These nodes are pure TEXT -> JSON reasoning (no images), unlike the vision
// node (scripts/analyzePhotoContent.mjs) — which needs per-image base64 encoding,
// keeps its own inline client, and runs on **OpenAI**, because DeepSeek's API
// serves no vision. Everything here is the text half these nodes share: config,
// one batched chat/completions call in JSON mode, retry, and the no-key STUB
// switch.
//
// DeepSeek is OpenAI-compatible, so we call it with raw `fetch` (Node global —
// no SDK added; project deps stay just `zod`). JSON mode
// (response_format: json_object) NUDGES toward JSON but does NOT enforce a
// schema and returns a top-level OBJECT (never a bare array). So callers ask
// for a wrapper object and each node re-validates every field against its own
// contract — the guardrail, not this client, is what makes the output safe.
//
// MODEL IDS (confirmed 2026-07-09 against api-docs.deepseek.com):
//   deepseek-v4-flash  — cheap/fast. THE DEFAULT HERE.
//   deepseek-v4-pro    — stronger, ~3x input / ~3x output price.
// The legacy names are retired on 2026/07/24 15:59 UTC and were only aliases:
//   deepseek-chat     == deepseek-v4-flash, thinking DISABLED
//   deepseek-reasoner == deepseek-v4-flash, thinking ENABLED
// So we pin v4-flash and send `thinking: {type:"disabled"}` to reproduce exactly
// what `deepseek-chat` did. These nodes want a steerable JSON emitter, not a
// reasoner: thinking mode costs more, is slower, and the docs do not state that
// it composes with response_format.
//
// Note `frequency_penalty` / `presence_penalty` are deprecated on this API; we
// don't send them.
//
// Env: DEEPSEEK_API_KEY (absent -> hasKey() false -> caller uses its STUB),
//   DEEPSEEK_MODEL (default "deepseek-v4-flash"), DEEPSEEK_BASE_URL
//   (default https://api.deepseek.com).

import { isRetryableStatus, MAX_ATTEMPTS, RETRY_BASE_MS, sleep } from "./retryPolicy.mjs";

export const apiKey = process.env.DEEPSEEK_API_KEY || "";
export const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
export const defaultModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

/** True when a real key is present. No key -> callers fall back to STUB. */
export function hasKey() {
  return Boolean(apiKey);
}

/** Provenance stamp for outputs: "stub" or "text:deepseek/<model>". */
export function provenance(model = defaultModel) {
  return hasKey() ? `text:deepseek/${model}` : "stub";
}

/**
 * One DeepSeek chat/completions call in JSON mode. Returns the PARSED top-level
 * JSON object exactly as the model produced it — no coercion; the caller owns
 * validation. Retries transient failures (network / 5xx / 429) up to 3x with a
 * linear backoff; a 4xx client error (bad key, bad request) throws immediately.
 *
 * @param {object}   opts
 * @param {string}   opts.system       System prompt (rubric + whitelist + JSON instruction).
 * @param {string}   opts.user         User prompt (the concrete task + data).
 * @param {string}  [opts.model]       Override DEEPSEEK_MODEL.
 * @param {number}  [opts.temperature] Default 0.4 (some creative range, still steerable).
 * @returns {Promise<object>} parsed top-level object
 */
export async function callDeepSeekJSON({ system, user, model = defaultModel, temperature = 0.4 }) {
  if (!hasKey()) throw new Error("callDeepSeekJSON requires DEEPSEEK_API_KEY (use hasKey() to branch to a stub)");
  const body = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    thinking: { type: "disabled" }, // == the retired `deepseek-chat` behaviour
    temperature,
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== "object") throw new Error("DeepSeek returned a non-object JSON payload");
        return parsed;
      }
      const detail = (await resp.text()).slice(0, 300);
      lastErr = new Error(`DeepSeek HTTP ${resp.status}: ${detail}`);
      // `break`, not `throw`: a throw here lands in the catch below, which records
      // it and lets the loop run again — the retry this branch exists to prevent.
      if (!isRetryableStatus(resp.status)) break;
    } catch (e) {
      lastErr = e; // network failure or an unparseable body — worth another attempt
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
  }
  throw lastErr ?? new Error("DeepSeek call failed");
}

// --- small coercion helpers shared by the node guardrails ------------------

/** Trim a value to a string and cap its length (drops non-strings to ""). */
export function str(v, max = 240) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

/** Return v if it is in `set`, else `fallback`. `set` may be a Set or Array. */
export function oneOf(v, set, fallback) {
  const has = set instanceof Set ? set.has(v) : set.includes(v);
  return has ? v : fallback;
}

/** Keep only array members present in `vocab` (a Set), de-duplicated. */
export function filterVocab(arr, vocab) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.filter((x) => vocab.has(x)))];
}
