// Phase F / node 4 — USER CHOICE.
//
// Takes the four story directions from node 3 and records which one the rest of
// the premium pipeline should realise. Not an AI call: a small state handoff
// between "customer may choose" and "production must continue".
//
// The design constraint (PIPELINE-V1-VA-LITE.md §3) is that offering a choice must
// not cost turnaround: send the options with a response window, keep working on
// other jobs, and if the window closes in silence, default and ship on time. That
// makes the window a real gate, not a note in a file. Three rules follow:
//
//   • THE DEADLINE IS ENFORCED. `--choice auto` before the window closes exits 3
//     ("still open"), it does not quietly default 24 hours early. Exit 3 is the
//     non-blocking contract: not an error — the orchestrator sets this job aside.
//
//   • A CUSTOMER ANSWER IS NEVER OVERWRITTEN by a later timeout default, and a
//     late answer is recorded as `late: true` rather than silently backdated. A
//     film delivered on an answer that arrived after the deadline is a different
//     fact from one delivered on time.
//
//   • A REPLY IS NEVER GUESSED. "A hay B?" names two options; picking one there
//     ships a film the customer did not choose. Ambiguous replies leave the job
//     pending for a human — the deadline still protects the SLA.
//
// The timeout default is `story_options.recommended` — node 3's best-fit-first
// ranking. Note the design doc suggests instead scoring the four directions
// against node 2's Story Importance / Emotion Score. That is deliberately NOT
// implemented: the options are prose (mood, captionTone), so scoring them
// numerically needs an invented mood→score table nobody can validate — and while
// `photo_content.generatedBy` is `stub` those scores are placeholders anyway.
//
// Usage:
//   node scripts/selectStoryOption.mjs --send [--channel console|file] [--timeout-hours 24]
//   node scripts/selectStoryOption.mjs --reply "Tôi chọn C"      # parse a free-text answer
//   node scripts/selectStoryOption.mjs --choice C                # operator records the answer
//   node scripts/selectStoryOption.mjs [--choice auto]           # default, only once the window closed
//   ... [--options analysis/story_options.json] [--out analysis/selected_story.json]
//       [--inbox analysis/choice_inbox.txt] [--customer-id <id>] [--opened-at <ISO>] [--force]
//
// Exit: 0 sent/decided · 3 window still open (NOT an error) · 1 error.
import fs from "node:fs";
import path from "node:path";
import { validate } from "./lib/checkSchema.mjs";
import { getChannel, renderOptionsMessage, parseReply, INBOX } from "./lib/channels.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);
const die = (msg) => {
  console.error(`[selectStoryOption] FAILED: ${msg}`);
  process.exit(1);
};
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const optionsPath = arg("--options", "analysis/story_options.json");
const outPath = arg("--out", "analysis/selected_story.json");
const rawChoice = (arg("--choice", "auto") || "auto").toUpperCase();
const timeoutHours = Number(arg("--timeout-hours", "24"));
const openedAtArg = arg("--opened-at", "");
const channelName = arg("--channel", "console");
const customerId = arg("--customer-id", "");
const replyArg = arg("--reply", "");
const inboxRel = arg("--inbox", INBOX);
const send = has("--send");
const force = has("--force");

const WINDOW = "analysis/story_choice_window.json";
const windowAbs = path.resolve(root, WINDOW);

if (!Number.isFinite(timeoutHours) || timeoutHours < 0) {
  die(`--timeout-hours must be a number >= 0, got "${arg("--timeout-hours", "24")}"`);
}

const absOptions = path.resolve(root, optionsPath);
if (!fs.existsSync(absOptions)) {
  die(`${optionsPath} not found. Run node 3 first: node scripts/generateStoryOptions.mjs`);
}
const optionsDoc = JSON.parse(fs.readFileSync(absOptions, "utf8"));
const options = Array.isArray(optionsDoc.options) ? optionsDoc.options : [];
if (options.length !== 4) die(`${optionsPath} must contain exactly 4 options`);
const ids = options.map((o) => o.id);
const recommended = /^[ABCD]$/.test(optionsDoc.recommended) ? optionsDoc.recommended : "A";

const readWindow = () => (fs.existsSync(windowAbs) ? JSON.parse(fs.readFileSync(windowAbs, "utf8")) : null);

// ---------------------------------------------------------------------------
// --send: open the response window by actually delivering the options.
// ---------------------------------------------------------------------------
if (send) {
  const prior = readWindow();
  if (prior && prior.status === "open" && !force) {
    die(
      `a response window is already open (${WINDOW}), sent ${prior.openedAt}, deadline ${prior.deadlineAt}.\n` +
        `  Re-sending pings the customer again and resets the deadline — pass --force if that is what you mean.`
    );
  }

  const openedAtMs = openedAtArg ? Date.parse(openedAtArg) : Date.now();
  if (!Number.isFinite(openedAtMs)) die(`--opened-at must be an ISO date, got "${openedAtArg}"`);
  const deadlineAt = new Date(openedAtMs + timeoutHours * 3600_000).toISOString();

  let channel;
  try {
    channel = getChannel(channelName, { root });
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }

  // Send FIRST, record second: if the transport throws, no window exists, so no
  // deadline ticks against a message that was never delivered.
  let delivery;
  try {
    delivery = channel.send(renderOptionsMessage(optionsDoc, { deadlineAt }));
  } catch (e) {
    die(`channel "${channelName}" could not send: ${e instanceof Error ? e.message : String(e)}`);
  }

  const win = {
    openedAt: new Date(openedAtMs).toISOString(),
    deadlineAt,
    timeoutHours,
    channel: channelName,
    sentVia: delivery.via,
    status: "open",
    ...(customerId ? { customerId } : {}),
  };
  fs.mkdirSync(path.dirname(windowAbs), { recursive: true });
  fs.writeFileSync(windowAbs, JSON.stringify(win, null, 2));

  console.log(
    `[selectStoryOption] 4 options sent via ${delivery.via}\n` +
      `  window: ${timeoutHours}h, deadline ${deadlineAt}\n` +
      `  default if silent: ${recommended} (story_options.recommended)\n` +
      `  NOT blocking. When a reply lands: --reply "..."   After the deadline: --choice auto`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// decide: from an explicit --choice, a parsed --reply, or the timeout default.
// ---------------------------------------------------------------------------
const explicit = /^[ABCD]$/.test(rawChoice);
if (!explicit && rawChoice !== "AUTO") die(`--choice must be A|B|C|D|auto, got "${rawChoice}"`);

let replyText = replyArg;
if (!replyText) {
  const inboxAbs = path.resolve(root, inboxRel);
  if (fs.existsSync(inboxAbs)) replyText = fs.readFileSync(inboxAbs, "utf8").trim();
}
const parsed = replyText ? parseReply(replyText, ids) : null;
if (replyText && explicit && parsed?.choice && parsed.choice !== rawChoice) {
  die(`--choice ${rawChoice} contradicts the reply, which says ${parsed.choice}. Resolve by hand.`);
}

const fromCustomer = explicit || Boolean(parsed?.choice);
const choice = explicit ? rawChoice : parsed?.choice || recommended;
const selected = options.find((o) => o.id === choice);
if (!selected) die(`option ${choice} not found in ${optionsPath}`);

// A window exists if --send opened one, or if the caller asserts one via --opened-at
// (the pre-existing 3-call flow). With neither, nobody was ever asked — and that is
// a legitimate state, not an error: a local one-shot run has no customer in the loop.
const persisted = readWindow();
const asserted =
  !persisted && openedAtArg
    ? (() => {
        const ms = Date.parse(openedAtArg);
        if (!Number.isFinite(ms)) die(`--opened-at must be an ISO date, got "${openedAtArg}"`);
        return {
          openedAt: new Date(ms).toISOString(),
          deadlineAt: new Date(ms + timeoutHours * 3600_000).toISOString(),
          timeoutHours,
        };
      })()
    : null;
const win = persisted || asserted;
const deadlineMs = win ? Date.parse(win.deadlineAt) : NaN;
const expired = Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : null;

// A customer's answer outranks a timeout default; a timeout default must never
// outrank a customer's answer.
const absOut = path.resolve(root, outPath);
const prior = fs.existsSync(absOut) ? JSON.parse(fs.readFileSync(absOut, "utf8")) : null;
if (prior && !force) {
  if (prior.source === "user") {
    console.log(
      `[selectStoryOption] already decided by the customer: ${prior.choice} "${prior.selected?.title}".\n` +
        `  Not overwriting${fromCustomer ? "" : " with a timeout default"}. Pass --force to change it.`
    );
    process.exit(0);
  }
  if (!fromCustomer) {
    console.log(`[selectStoryOption] already defaulted to ${prior.choice} (auto) — nothing to do.`);
    process.exit(0);
  }
  // prior was auto, a real answer arrived: the customer wins, fall through.
}

if (!fromCustomer) {
  // The timeout path. Never fire early against a window the customer was actually
  // promised. (With no window at all there is no promise to break — the old bug
  // was not defaulting immediately, it was recording a fictitious 24h window while
  // doing so. See the decisionWindow assembled below.)
  if (win && expired === false && !force) {
    const mins = Math.round((deadlineMs - Date.now()) / 60000);
    const why = replyText ? `reply unusable (${parsed.error})` : "no reply yet";
    console.log(
      `[selectStoryOption] PENDING — ${why}; ${mins} min left (deadline ${win.deadlineAt}).\n` +
        `  The job is not blocked: pick up other work and re-run when a reply lands or the window closes.`
    );
    if (replyText) console.log(`  reply seen: ${JSON.stringify(cap(replyText, 120))}`);
    process.exit(3);
  }
}

// With no window, the honest record is a ZERO-LENGTH one: nobody was given time
// to answer. Writing `openedAt: now, deadlineAt: now + 24h` here — as this node
// once did — claims a deadline that was never offered and never waited for.
const nowIso = new Date().toISOString();
const decisionWindow = win
  ? { openedAt: win.openedAt, deadlineAt: win.deadlineAt, timeoutHours: win.timeoutHours }
  : { openedAt: nowIso, deadlineAt: nowIso, timeoutHours: 0 };

let reason;
if (fromCustomer) {
  reason = explicit ? `customer selected option ${choice}` : `customer replied, parsed as option ${choice}`;
  if (expired === true) reason += `; arrived after the ${decisionWindow.deadlineAt} deadline`;
} else if (win && expired === false && force) {
  reason = `--force: defaulted to story_options.recommended=${recommended} before the window closed`;
} else if (!win) {
  reason = `no response window was opened (nobody was asked); defaulted to story_options.recommended=${recommended}`;
} else {
  reason = `no valid reply before ${decisionWindow.deadlineAt}; used story_options.recommended=${recommended}`;
  if (replyText) reason += ` (a reply arrived but was unusable: ${parsed.error})`;
}

const out = {
  generatedBy: "node4:user-choice",
  generatedAt: new Date().toISOString(),
  optionsPath,
  choice,
  source: fromCustomer ? "user" : "auto",
  reason: cap(reason, 240),
  ...(fromCustomer && expired === true ? { late: true } : {}),
  ...(replyText && !explicit ? { reply: cap(replyText, 500) } : {}),
  ...(win?.channel ? { channel: win.channel } : channelName ? { channel: channelName } : {}),
  ...(win?.sentVia ? { sentVia: cap(win.sentVia, 200) } : {}),
  ...(customerId || win?.customerId ? { customerId: customerId || win.customerId } : {}),
  selected,
  decisionWindow,
};

const schema = JSON.parse(fs.readFileSync(path.resolve(root, "schema/selected-story.schema.json"), "utf8"));
const errors = validate(schema, out);
if (errors.length) {
  console.error("[selectStoryOption] selected_story failed schema:");
  for (const e of errors.slice(0, 20)) console.error("  - " + e);
  process.exit(1);
}

fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(out, null, 2));
if (win) {
  win.status = "closed";
  fs.writeFileSync(windowAbs, JSON.stringify(win, null, 2));
}

console.log(
  `[selectStoryOption] option ${choice} "${selected.title}" -> ${outPath} (${out.source}` +
    `${out.late ? ", LATE" : ""})\n` +
    `  ${out.reason}\n` +
    `  Next: node scripts/generateDirectorNotes.mjs`
);
