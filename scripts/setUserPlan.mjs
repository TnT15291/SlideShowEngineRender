import fs from "node:fs";
import path from "node:path";
import { arg, root } from "./lib/project.mjs";

const username = String(arg("--username", "")).trim().toLowerCase();
const type = arg("--type", "");

if (!username || !["subscription", "per_video"].includes(type)) {
  throw new Error(
    "Usage: node scripts/setUserPlan.mjs --username <name> --type subscription --quota <n>\n" +
    "       node scripts/setUserPlan.mjs --username <name> --type per_video --credits <n>",
  );
}

function positiveInt(flag) {
  const raw = arg(flag);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${flag} must be a non-negative integer`);
  return value;
}

const plan = type === "subscription"
  ? { type, monthlyRenderQuota: positiveInt("--quota"), rendersUsedThisPeriod: 0, periodStart: new Date().toISOString() }
  : { type, creditsRemaining: positiveInt("--credits") };

const usersFile = path.join(root, "server", "data", "studio-users.json");
if (!fs.existsSync(usersFile)) throw new Error(`No user store found at ${usersFile}`);
const store = JSON.parse(fs.readFileSync(usersFile, "utf8"));

const index = store.users.findIndex((user) => user.username === username);
if (index === -1) throw new Error(`No user named "${username}"`);

store.users[index] = { ...store.users[index], plan };
fs.writeFileSync(usersFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");

console.log(`Set plan for "${username}":`, plan);
