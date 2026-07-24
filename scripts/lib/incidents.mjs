import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { root } from "./project.mjs";

function database(engineRoot) {
  const databasePath = path.join(engineRoot, "server", "data", "incidents.sqlite");
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    code TEXT NOT NULL,
    project_id TEXT NOT NULL,
    user_id TEXT,
    phase TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    message TEXT NOT NULL,
    technical_detail TEXT,
    customer_impact TEXT NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS incidents_status_updated ON incidents(status, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS incidents_open_fingerprint ON incidents(fingerprint) WHERE status != 'resolved';`);
  return db;
}

async function notifyIncident(incident) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.STOREEL_ALERT_EMAIL;
  if (!apiKey || !to) return;
  const from = process.env.STOREEL_ALERT_FROM || "StoReel Alerts <onboarding@resend.dev>";
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to: [to], subject: `[StoReel] ${incident.code} · ${incident.projectId}`,
        text: [
          `Incident: ${incident.id}`, `Code: ${incident.code}`, `Project: ${incident.projectId}`,
          `Phase: ${incident.phase}`, `Customer impact: ${incident.customerImpact}`,
        ].join("\n"),
      }),
    });
  } catch {
    // Alert delivery must never turn a recoverable pipeline problem into another failure.
  }
}

export async function recordIncident(input, engineRoot = root) {
  const now = new Date().toISOString();
  const fingerprint = createHash("sha256").update(`${input.code}|${input.projectId}|${input.phase}`).digest("hex");
  const db = database(engineRoot);
  try {
    const existing = db.prepare("SELECT id FROM incidents WHERE fingerprint = ? AND status != 'resolved'").get(fingerprint);
    if (existing) {
      db.prepare("UPDATE incidents SET occurrences = occurrences + 1, updated_at = ?, message = ?, technical_detail = ? WHERE id = ?")
        .run(now, input.message, input.technicalDetail || null, existing.id);
      return existing.id;
    }
    const id = `INC-${now.slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
    db.prepare(`INSERT INTO incidents
      (id, fingerprint, code, project_id, user_id, phase, message, technical_detail, customer_impact, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, fingerprint, input.code, input.projectId, input.userId || null, input.phase, input.message,
        input.technicalDetail || null, input.customerImpact, now, now);
    await notifyIncident({ id, ...input });
    return id;
  } finally {
    db.close();
  }
}
