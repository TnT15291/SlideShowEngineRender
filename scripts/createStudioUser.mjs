import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { arg, root } from "./lib/project.mjs";

const scryptAsync = promisify(scrypt);
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

const username = String(arg("--username", "")).trim().toLowerCase();
const password = arg("--password", "");
if (!username || !password) {
  throw new Error("Usage: node scripts/createStudioUser.mjs --username <name> --password <secret>");
}
if (password.length < 8) throw new Error("Password must be at least 8 characters");

const usersFile = path.join(root, "server", "data", "studio-users.json");
fs.mkdirSync(path.dirname(usersFile), { recursive: true });

const store = fs.existsSync(usersFile)
  ? JSON.parse(fs.readFileSync(usersFile, "utf8"))
  : { version: 1, users: [] };
if (store.users.some((user) => user.username === username)) {
  throw new Error(`A user named ${username} already exists`);
}

const salt = randomBytes(SALT_BYTES).toString("hex");
const derived = await scryptAsync(password, salt, KEY_LENGTH);
const passwordHash = `scrypt$${salt}$${derived.toString("hex")}`;

store.users.push({ id: randomUUID(), username, passwordHash, createdAt: new Date().toISOString() });
fs.writeFileSync(usersFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
console.log(`Created studio user "${username}".`);
