// Node 4's boundary with the outside world.
//
// The pipeline must never *believe* it asked the customer when it did not. A
// message that silently goes nowhere is worse than a crash: the 24h window still
// expires, the timeout default still fires, and a film ships under a choice
// nobody was ever offered. So an unconfigured channel THROWS — the same stance
// the vision node takes when VISION_BASE_URL points somewhere that cannot serve it.
//
// `console` and `file` are real, complete transports (a human relays the message).
// `zalo`/`messenger` are named in the design but have no transport, and say so.
import fs from "node:fs";
import path from "node:path";

export const CHANNELS = ["console", "file", "zalo", "messenger"];

export const OUTBOX = "analysis/choice_outbox.txt";
export const INBOX = "analysis/choice_inbox.txt";

/** Render the 4 options as a message a person can read and reply to. */
export function renderOptionsMessage(optionsDoc, { deadlineAt }) {
  const lines = [
    "Chào bạn! Video cưới của mình có thể kể theo 4 hướng khác nhau.",
    "Bạn chọn giúp mình 1 hướng nhé — chỉ cần nhắn lại một chữ cái (A, B, C hoặc D).",
    "",
  ];
  for (const o of optionsDoc.options || []) {
    lines.push(`${o.id}. ${o.title} — ${o.mood}`);
    if (o.summary) lines.push(`   ${o.summary}`);
    lines.push("");
  }
  const rec = optionsDoc.recommended || "A";
  lines.push(`Nếu sau ${new Date(deadlineAt).toLocaleString("vi-VN")} mình chưa nhận được trả lời,`);
  lines.push(`mình sẽ dựng theo hướng ${rec} (hướng hợp bộ ảnh nhất) để kịp giao đúng hẹn.`);
  return lines.join("\n");
}

/**
 * Resolve a transport. Returns `{ name, send(text) -> { via } }`.
 * Throws for any channel that cannot actually deliver.
 */
export function getChannel(name, { root = process.cwd() } = {}) {
  if (!CHANNELS.includes(name)) {
    throw new Error(`unknown channel "${name}" — expected one of: ${CHANNELS.join(", ")}`);
  }

  if (name === "console") {
    return {
      name,
      send(text) {
        console.log("\n" + "─".repeat(64));
        console.log(text);
        console.log("─".repeat(64) + "\n");
        return { via: "console (relay this to the customer yourself)" };
      },
    };
  }

  if (name === "file") {
    return {
      name,
      send(text) {
        const abs = path.resolve(root, OUTBOX);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text, "utf8");
        return { via: OUTBOX };
      },
    };
  }

  // zalo / messenger: named in the design, no transport written. Refuse rather
  // than hand back a channel whose send() is a no-op.
  const envKey = name === "zalo" ? "ZALO_OA_TOKEN" : "MESSENGER_PAGE_TOKEN";
  const hasToken = Boolean(process.env[envKey]);
  throw new Error(
    `channel "${name}" has no transport implemented` +
      (hasToken ? ` (${envKey} is set, but nothing sends it yet)` : ` and ${envKey} is not set`) +
      `.\n  Refusing rather than pretending the customer was asked — the response window would expire` +
      `\n  on a message that never left this machine. Use --channel console (relay by hand) or --channel file.`
  );
}

/**
 * Pull the single option letter out of a free-text reply.
 * Returns { choice } | { error } — never a guess.
 *
 * The letter must stand alone: the C in "Tôi chọn C." matches, but the C in
 * "Cảm ơn" does not, because a letter follows it. Two different letters
 * ("A hay B?") is an ambiguous reply, and a pipeline that guesses there is a
 * pipeline that ships the wrong film — so it stays pending and a human looks.
 */
export function parseReply(text, validIds = ["A", "B", "C", "D"]) {
  if (typeof text !== "string" || !text.trim()) return { error: "empty reply" };
  const found = new Set();
  const re = /(?<!\p{L})([ABCD])(?!\p{L})/giu;
  let m;
  while ((m = re.exec(text))) {
    const id = m[1].toUpperCase();
    if (validIds.includes(id)) found.add(id);
  }
  if (found.size === 0) return { error: `no option letter (${validIds.join("/")}) found in reply` };
  if (found.size > 1) return { error: `ambiguous — reply names ${[...found].sort().join(" and ")}` };
  return { choice: [...found][0] };
}
