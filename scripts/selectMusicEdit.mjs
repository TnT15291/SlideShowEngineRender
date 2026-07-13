// Premium gate 4b — WHO DECIDES WHAT HAPPENS TO THE SONG.
//
// Auto-cutting the track to a highlight is a TIER-1 rule (the user designed it for
// few-photos-long-music jobs, where it is the right cheap-tier answer). Premium is the
// tier where the customer is in the loop — so when their photo set cannot carry their
// full song, premium does not decide for them. It ASKS, with the same response-window
// contract as node 4 (selectStoryOption): exit 3 while the window is open, a customer
// answer outranks a timeout default, a late answer is marked late, an ambiguous reply
// stays pending for a human.
//
// THE QUESTION ONLY EXISTS SOMETIMES. Three ways it never gets asked:
//   • the photos CAN carry the full song (budget < 7.2s/photo) → full_song, source
//     "natural", zero-length window — there is no trade-off to put to anyone;
//   • the ledger already answers it (a music_mode or duration directive) → the customer
//     has spoken in their own prompt, and asking again is asking them to repeat
//     themselves → source "ledger";
//   • the brief pins musicMode → source "brief".
//
// The timeout default is HIGHLIGHT — the tier-1 rule, because it is the answer that
// never ships a crawling film. The default is stated in the message the customer gets.
//
// Usage (mirrors selectStoryOption):
//   node scripts/selectMusicEdit.mjs --music-analysis <analysis/music/x.json> --photos <photos.json>
//     [--send | --send-if-needed] [--channel console|file] [--timeout-hours 24]
//     [--reply "B"] [--choice highlight|full|auto]
//     [--brief brief.json] [--directives directives.json]
//     [--out analysis/selected_music.json] [--inbox analysis/music_inbox.txt] [--force]
//
// Exit: 0 decided (or no question to ask) · 3 window still open (NOT an error) · 1 error.
import fs from "node:fs";
import path from "node:path";
import { validate } from "./lib/checkSchema.mjs";
import { getChannel, renderMusicChoiceMessage, parseReply } from "./lib/channels.mjs";
import { chooseMusicEdit, needsExcerpt, FULL_SONG_MAX_SEC_PER_PHOTO } from "./lib/musicHighlight.mjs";
import { loadLedger, active } from "./lib/directives.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);
const die = (msg) => {
  console.error(`[selectMusicEdit] FAILED: ${msg}`);
  process.exit(1);
};
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const musicJsonPath = arg("--music-analysis", "");
const photosPath = arg("--photos", "analysis/photos.json");
const briefPath = arg("--brief", "");
const directivesPath = arg("--directives", "");
const outPath = arg("--out", "analysis/selected_music.json");
const rawChoice = (arg("--choice", "auto") || "auto").toLowerCase();
const timeoutHours = Number(arg("--timeout-hours", "24"));
const channelName = arg("--channel", "console");
const customerId = arg("--customer-id", "");
const replyArg = arg("--reply", "");
const inboxRel = arg("--inbox", `${path.dirname(outPath).replace(/\\/g, "/")}/music_inbox.txt`);
const send = has("--send");
const sendIfNeeded = has("--send-if-needed");
const force = has("--force");

if (!musicJsonPath) die("--music-analysis is required (analysis/music/<track>.json)");
if (!Number.isFinite(timeoutHours) || timeoutHours < 0) die(`--timeout-hours must be >= 0`);

const MODES = { highlight: "highlight", full: "full_song", full_song: "full_song", auto: "auto" };
if (!(rawChoice in MODES)) die(`--choice must be highlight|full|auto, got "${rawChoice}"`);

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

if (!exists(musicJsonPath)) die(`music analysis not found: ${musicJsonPath} — run analyzeMusic first`);
if (!exists(photosPath)) die(`photos not found: ${photosPath}`);
const music = readJson(musicJsonPath);
const brief = exists(briefPath) ? readJson(briefPath) : {};
const excluded = new Set(brief.excludePhotos || []);
const photoCount = (readJson(photosPath).photos ?? []).filter((p) => !excluded.has(p.file)).length;
if (!photoCount) die(`${photosPath} has no photos`);
const sourceDuration = Number(music.duration) || 0;

// The window this gate is offering — computed ONCE here so the message, the decision
// record and the eventual cut all describe the same excerpt.
const preview = chooseMusicEdit(music, photoCount, { mode: "highlight" });

const WINDOW = `${path.dirname(outPath).replace(/\\/g, "/")}/music_choice_window.json`;
const OUTBOX_FILE = `${path.dirname(outPath).replace(/\\/g, "/")}/music_outbox.txt`;
const windowAbs = path.resolve(root, WINDOW);
const readWindow = () => (fs.existsSync(windowAbs) ? JSON.parse(fs.readFileSync(windowAbs, "utf8")) : null);
const absOut = path.resolve(root, outPath);

function writeDecision(doc) {
  const out = {
    generatedBy: "node4b:music-choice",
    generatedAt: new Date().toISOString(),
    sourceDuration: +sourceDuration.toFixed(3),
    photoCount,
    secondsPerPhotoFullSong: +(sourceDuration / photoCount).toFixed(2),
    threshold: FULL_SONG_MAX_SEC_PER_PHOTO,
    preview,
    ...doc,
  };
  const schema = readJson("schema/selected-music.schema.json");
  const errors = validate(schema, out);
  if (errors.length) {
    console.error("[selectMusicEdit] selected_music failed schema:");
    for (const e of errors.slice(0, 20)) console.error("  - " + e);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(out, null, 2));
  const win = readWindow();
  if (win && win.status === "open") {
    win.status = "closed";
    fs.writeFileSync(windowAbs, JSON.stringify(win, null, 2));
  }
  console.log(
    `[selectMusicEdit] ${out.mode} -> ${outPath} (${out.source}${out.late ? ", LATE" : ""})\n  ${out.reason}`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Cases where the question never gets asked.
// ---------------------------------------------------------------------------
const zeroWindow = () => {
  const now = new Date().toISOString();
  return { openedAt: now, deadlineAt: now, timeoutHours: 0 };
};

// A prior USER decision stands, exactly as in node 4.
const prior = fs.existsSync(absOut) ? JSON.parse(fs.readFileSync(absOut, "utf8")) : null;
const explicitChoice = rawChoice !== "auto";
let replyText = replyArg;
if (!replyText) {
  const inboxAbs = path.resolve(root, inboxRel);
  if (fs.existsSync(inboxAbs)) replyText = fs.readFileSync(inboxAbs, "utf8").trim();
}
const parsed = replyText ? parseReply(replyText, ["A", "B"]) : null;
const replyMode = parsed?.choice === "A" ? "highlight" : parsed?.choice === "B" ? "full_song" : null;
if (replyMode && explicitChoice && MODES[rawChoice] !== replyMode) {
  die(`--choice ${rawChoice} contradicts the reply, which says ${parsed.choice} (${replyMode}). Resolve by hand.`);
}
const fromCustomer = explicitChoice || Boolean(replyMode);

if (prior && !force) {
  if (prior.source === "user") {
    console.log(`[selectMusicEdit] already decided by the customer: ${prior.mode}. Pass --force to change it.`);
    process.exit(0);
  }
  if (!fromCustomer && !send) {
    console.log(`[selectMusicEdit] already decided (${prior.mode}, ${prior.source}) — nothing to do.`);
    process.exit(0);
  }
  // prior was not the customer's and a real answer arrived: the customer wins.
}

// The customer's own prompt already answers the question — asking again would be
// asking them to repeat themselves.
const orders = directivesPath && exists(directivesPath) ? active(loadLedger(directivesPath)) : [];
const modeOrder = orders.find((d) => d.kind === "music_mode" && d.op === "set");
const durationOrder = orders.find((d) => d.kind === "duration" && d.op === "set");
if (!fromCustomer) {
  if (modeOrder) {
    writeDecision({
      mode: modeOrder.target,
      source: "ledger",
      reason: `the prompt already orders music_mode=${modeOrder.target} ("${cap(modeOrder.quote, 120)}"); no question to ask`,
      decisionWindow: zeroWindow(),
    });
  }
  if (durationOrder) {
    writeDecision({
      mode: "auto",
      source: "ledger",
      reason: `the prompt already orders a ${durationOrder.target}s film ("${cap(durationOrder.quote, 120)}"); the window follows that length`,
      decisionWindow: zeroWindow(),
    });
  }
  if (brief.musicMode) {
    writeDecision({
      mode: MODES[brief.musicMode] || "auto",
      source: "brief",
      reason: `brief.json pins musicMode=${brief.musicMode}; no question to ask`,
      decisionWindow: zeroWindow(),
    });
  }
  // No trade-off exists: the photos carry the whole song naturally.
  if (!needsExcerpt(music, photoCount)) {
    writeDecision({
      mode: "full_song",
      source: "natural",
      reason: `${photoCount} photos carry the ${sourceDuration.toFixed(0)}s track at ${(sourceDuration / photoCount).toFixed(1)}s/photo (< ${FULL_SONG_MAX_SEC_PER_PHOTO}s); nothing to cut`,
      decisionWindow: zeroWindow(),
    });
  }
}

// ---------------------------------------------------------------------------
// The question exists. Send / pending / decide — node 4's window contract.
// ---------------------------------------------------------------------------
const win = readWindow();

if (send || (sendIfNeeded && !win && !fromCustomer)) {
  if (win && win.status === "open" && !force) {
    if (send) {
      die(`a response window is already open (${WINDOW}), deadline ${win.deadlineAt}. --force re-sends.`);
    }
    // --send-if-needed with an open window falls through to the pending check below.
  } else {
    const deadlineAt = new Date(Date.now() + timeoutHours * 3600_000).toISOString();
    let channel;
    try {
      channel = getChannel(channelName, { root, outbox: OUTBOX_FILE });
    } catch (e) {
      die(e instanceof Error ? e.message : String(e));
    }
    // Send FIRST, record second — no deadline may tick against an undelivered message.
    let delivery;
    try {
      delivery = channel.send(
        renderMusicChoiceMessage({ sourceDuration, photoCount, preview, deadlineAt, defaultMode: "highlight" })
      );
    } catch (e) {
      die(`channel "${channelName}" could not send: ${e instanceof Error ? e.message : String(e)}`);
    }
    const opened = {
      openedAt: new Date().toISOString(),
      deadlineAt,
      timeoutHours,
      channel: channelName,
      sentVia: delivery.via,
      status: "open",
      ...(customerId ? { customerId } : {}),
    };
    fs.mkdirSync(path.dirname(windowAbs), { recursive: true });
    fs.writeFileSync(windowAbs, JSON.stringify(opened, null, 2));
    console.log(
      `[selectMusicEdit] music question sent via ${delivery.via}\n` +
        `  window: ${timeoutHours}h, deadline ${deadlineAt}\n` +
        `  default if silent: highlight (~${Math.round(preview.duration)}s)\n` +
        `  When a reply lands: --reply "A|B"   Operator: --choice highlight|full`
    );
    if (send) process.exit(0); // bare --send is fire-and-return; --send-if-needed pauses below
  }
}

const winNow = readWindow();
const deadlineMs = winNow ? Date.parse(winNow.deadlineAt) : NaN;
const expired = Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : null;

if (!fromCustomer) {
  if (winNow && expired === false && !force) {
    const mins = Math.round((deadlineMs - Date.now()) / 60000);
    const why = replyText ? `reply unusable (${parsed.error})` : "no reply yet";
    console.log(
      `[selectMusicEdit] PENDING — ${why}; ${mins} min left (deadline ${winNow.deadlineAt}).\n` +
        `  The job is paused, not broken: re-run when a reply lands or the window closes.`
    );
    if (replyText) console.log(`  reply seen: ${JSON.stringify(cap(replyText, 120))}`);
    process.exit(3);
  }
  if (!winNow) {
    // Nobody was asked and nobody is going to be (no --send-if-needed): a local
    // one-shot run. The honest default is the tier-1 rule, on a zero-length window.
    writeDecision({
      mode: "highlight",
      source: "auto",
      reason: `no response window was opened (nobody was asked); tier-1 rule applies at ${(sourceDuration / photoCount).toFixed(1)}s/photo`,
      decisionWindow: zeroWindow(),
    });
  }
}

const decisionWindow = winNow
  ? { openedAt: winNow.openedAt, deadlineAt: winNow.deadlineAt, timeoutHours: winNow.timeoutHours }
  : zeroWindow();

if (fromCustomer) {
  const mode = explicitChoice ? MODES[rawChoice] : replyMode;
  let reason = explicitChoice
    ? `customer selected ${mode} (recorded by operator)`
    : `customer replied "${cap(replyText, 80)}", parsed as ${parsed.choice} (${mode})`;
  if (expired === true) reason += `; arrived after the ${decisionWindow.deadlineAt} deadline`;
  writeDecision({
    mode,
    source: "user",
    reason,
    ...(expired === true ? { late: true } : {}),
    ...(replyText && !explicitChoice ? { reply: cap(replyText, 500) } : {}),
    ...(winNow?.channel ? { channel: winNow.channel } : {}),
    ...(customerId || winNow?.customerId ? { customerId: customerId || winNow.customerId } : {}),
    decisionWindow,
  });
}

// Window closed in silence: the tier-1 default, stated as such.
writeDecision({
  mode: "highlight",
  source: "auto",
  reason: replyText
    ? `no usable reply before ${decisionWindow.deadlineAt} (last reply: ${parsed.error}); defaulted to highlight`
    : `no reply before ${decisionWindow.deadlineAt}; defaulted to highlight (the rule the customer was told)`,
  decisionWindow,
});
