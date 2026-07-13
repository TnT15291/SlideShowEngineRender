// THE PREVIEW GATE. Show them the cut, then wait — without stalling the shop.
//
// This is node 4's twin, and deliberately so. Node 4 already solved "pause a job on a
// human without paying for it in turnaround", and its three rules are exactly the rules
// a preview needs, so they are reused rather than re-derived:
//
//   • THE DEADLINE IS ENFORCED. Waiting for feedback exits 3 ("still open") — not an
//     error, a state. The orchestrator sets this job aside and picks up other work. If
//     the window closes in silence, the cut they were shown is the cut they get.
//
//   • A CUSTOMER'S ANSWER IS NEVER OVERWRITTEN by a timeout, and an answer that arrives
//     late is recorded as late rather than backdated.
//
//   • A REPLY IS NEVER GUESSED. "ừ cũng được nhưng mà..." is not an approval. An
//     ambiguous reply leaves the job pending for a human — shipping a film on a reply we
//     guessed at is worse than shipping it a day later.
//
// What lands here is a CHANGE REQUEST, not a choice, so the reply is handed to
// reviseProject.mjs, which compiles it into directives and re-enters the pipeline at the
// lowest phase that can satisfy it.
//
// Exit: 0 approved / revision recorded · 3 window still open (NOT an error) · 1 error.
//
// Usage:
//   node scripts/reviewPreview.mjs --project <dir> --send [--channel console|file] [--timeout-hours 48]
//   node scripts/reviewPreview.mjs --project <dir> --reply "đoạn bạn bè nhanh hơn nhé"  [--revise]
//   node scripts/reviewPreview.mjs --project <dir>            # check the window / apply the timeout
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getChannel } from "./lib/channels.mjs";
import { loadLedger, active, formatReport } from "./lib/directives.mjs";
import { arg, loadProject, root } from "./lib/project.mjs";
import { appendFeedback } from "./lib/feedbackLedger.mjs";

const has = (flag) => process.argv.includes(flag);
const die = (msg) => { console.error(`[reviewPreview] FAILED: ${msg}`); process.exit(1); };
const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

const projectArg = arg("--project");
const project = loadProject(projectArg);
const send = has("--send");
const revise = has("--revise");
const force = has("--force");
const replyArg = arg("--reply", "");
const channelName = arg("--channel", "console");
const timeoutHours = Number(arg("--timeout-hours", "48"));
if (!Number.isFinite(timeoutHours) || timeoutHours < 0) die(`--timeout-hours must be a number >= 0`);

const analysisDir = project.rel(project.manifest.analysisDir);
const WINDOW = project.abs(`${project.manifest.analysisDir}/preview_window.json`);
const DECISION = project.abs(`${project.manifest.analysisDir}/preview_decision.json`);
const INBOX = project.abs(`${project.manifest.analysisDir}/preview_inbox.txt`);
const compliancePath = project.abs(`${project.manifest.analysisDir}/compliance.json`);
const videoOut = project.abs(project.manifest.output);

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);
const readWindow = () => readJson(WINDOW);
const feedbackContext = () => { const tl = readJson(project.abs(project.manifest.timeline)); return { root, analysisDir: project.rel(project.manifest.analysisDir), projectId: project.manifest.id,
  recipeId: tl?.recipeDecisions?.recipeId || tl?.recipeDecisions?.recipe || project.manifest.recipe || null, pacing: tl?.recipeDecisions?.pacingVariant || null }; };

// ---------------------------------------------------------------------------
// --send: there must BE a preview. Asking someone to approve a film we never
// rendered is how a job sits "awaiting feedback" for a week on nothing.
// ---------------------------------------------------------------------------
if (send) {
  if (!fs.existsSync(videoOut)) {
    die(`there is no preview to show: ${project.manifest.output} does not exist.\n` +
      `  Render it first:  node scripts/runProject.mjs --project ${projectArg}`);
  }
  const prior = readWindow();
  if (prior?.status === "open" && !force) {
    die(`a preview window is already open (sent ${prior.openedAt}, deadline ${prior.deadlineAt}).\n` +
      `  Re-sending pings them again and resets the deadline — pass --force if that is what you mean.`);
  }

  const deadlineAt = new Date(Date.now() + timeoutHours * 3600_000).toISOString();

  // Show them the receipt with the cut. A customer who can see WHICH of their requests
  // landed — and which we could not do — asks for the right next thing. One who cannot
  // see it re-asks for what they already have.
  const compliance = readJson(compliancePath);
  const lines = [
    `Bản dựng thử đã xong: ${project.manifest.output}`,
    "",
    ...(compliance?.results?.length
      ? ["Những gì anh/chị đã dặn:", formatReport(compliance, compliance.unmapped || []), ""]
      : []),
    `Anh/chị xem và cho biết muốn sửa gì — cứ nói bình thường ("đoạn bạn bè nhanh hơn", "bỏ chữ ở cảnh cuối").`,
    `Nếu không cần sửa gì thì trả lời "duyệt" là mình xuất bản chính thức.`,
    `Hạn phản hồi: ${deadlineAt}. Sau hạn này mình sẽ xuất bản đúng bản anh/chị đang xem.`,
  ];

  let channel, delivery;
  try {
    channel = getChannel(channelName, { root });
  } catch (e) {
    die(e instanceof Error ? e.message : String(e));
  }
  // Send FIRST, record second: if the transport throws, no window exists, and no
  // deadline ticks against a message that was never delivered.
  try {
    delivery = channel.send(lines.join("\n"));
  } catch (e) {
    die(`channel "${channelName}" could not send: ${e instanceof Error ? e.message : String(e)}`);
  }

  fs.mkdirSync(path.dirname(WINDOW), { recursive: true });
  fs.writeFileSync(WINDOW, JSON.stringify({
    openedAt: new Date().toISOString(), deadlineAt, timeoutHours,
    channel: channelName, sentVia: delivery.via, status: "open",
    previewOf: project.manifest.output,
  }, null, 2));

  console.log(
    `[reviewPreview] preview sent via ${delivery.via}\n` +
      `  window: ${timeoutHours}h, deadline ${deadlineAt}\n` +
      `  NOT blocking. When they reply: --reply "..."  |  after the deadline: re-run with no flags`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// decide
// ---------------------------------------------------------------------------
let replyText = replyArg.trim();
if (!replyText && fs.existsSync(INBOX)) replyText = fs.readFileSync(INBOX, "utf8").trim();

const win = readWindow();
const deadlineMs = win ? Date.parse(win.deadlineAt) : NaN;
const expired = Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : null;

// An approval is a SHORT, WHOLE reply. "duyệt", "ok em", "đẹp rồi nhé" — yes. But
// "ok nhưng đoạn cuối chậm quá" contains an approval word and is plainly not one, so a
// reply carrying any change-shaped language is never read as approval. Guessing "yes"
// from a message that says "but" is how a film ships that nobody agreed to.
const APPROVE = /^(?:ok|oke|okay|duyệt|đồng ý|được rồi|đẹp rồi|ưng|good|approve[d]?|chốt|xuất bản|ship it)\b/i;
const HAS_CHANGE = /nhưng|mà|tuy nhiên|however|but|sửa|đổi|bỏ|thêm|chậm|nhanh|đừng|không/i;
const isApproval = (t) => APPROVE.test(t.trim()) && !HAS_CHANGE.test(t) && t.trim().length <= 60;

const prior = readJson(DECISION);
if (prior?.source === "user" && !force) {
  console.log(`[reviewPreview] already answered by the customer (${prior.decision}). Not overwriting. Pass --force to change it.`);
  process.exit(0);
}

if (!replyText) {
  if (win && expired === false && !force) {
    const mins = Math.round((deadlineMs - Date.now()) / 60000);
    console.log(
      `[reviewPreview] PENDING — no feedback yet; ${mins} min left (deadline ${win.deadlineAt}).\n` +
        `  The job is not blocked: pick up other work and re-run when they reply or the window closes.`
    );
    process.exit(3);
  }
  // The window closed in silence. They were shown a cut and did not object to it, so
  // that cut ships — and we record that nobody actually said yes.
  const decision = {
    decidedAt: new Date().toISOString(), decision: "approved",
    source: "auto",
    reason: win
      ? `no feedback before ${win.deadlineAt}; shipping the cut they were shown`
      : `no preview window was opened (nobody was asked); nothing to wait for`,
  };
  fs.mkdirSync(path.dirname(DECISION), { recursive: true });
  fs.writeFileSync(DECISION, JSON.stringify(decision, null, 2));
  appendFeedback({ ...feedbackContext(), type: "preview_approved", data: { source: "auto" } });
  if (win) { win.status = "closed"; fs.writeFileSync(WINDOW, JSON.stringify(win, null, 2)); }
  console.log(`[reviewPreview] ${decision.reason} -> approved (auto)`);
  process.exit(0);
}

// --- a reply arrived --------------------------------------------------------
const approved = isApproval(replyText);
const decision = {
  decidedAt: new Date().toISOString(),
  decision: approved ? "approved" : "revision_requested",
  source: "user",
  reply: cap(replyText, 500),
  ...(expired === true ? { late: true } : {}),
  ...(win?.channel ? { channel: win.channel } : {}),
};
fs.mkdirSync(path.dirname(DECISION), { recursive: true });
fs.writeFileSync(DECISION, JSON.stringify(decision, null, 2));
appendFeedback({ ...feedbackContext(), type: approved ? "preview_approved" : "revision_requested", data: { source: "user", late: Boolean(decision.late) } });
if (win) { win.status = "closed"; fs.writeFileSync(WINDOW, JSON.stringify(win, null, 2)); }

if (approved) {
  console.log(`[reviewPreview] APPROVED by the customer${decision.late ? " (late)" : ""}: ${JSON.stringify(cap(replyText, 80))}`);
  console.log(`  Next: node scripts/runProject.mjs --project ${projectArg} --resume --deliver`);
  process.exit(0);
}

console.log(`[reviewPreview] revision requested${decision.late ? " (late)" : ""}: ${JSON.stringify(cap(replyText, 120))}`);
const args = ["scripts/reviseProject.mjs", "--project", projectArg, "--request", replyText];
if (!revise) {
  console.log(`\n  Nothing has been changed yet. To compile and apply their words:\n    node ${args.join(" ")}`);
  process.exit(0);
}
const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
