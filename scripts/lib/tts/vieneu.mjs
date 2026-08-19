import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export function createProvider() {
  const localPython = path.resolve(
    process.platform === "win32" ? ".venv-vieneu/Scripts/python.exe" : ".venv-vieneu/bin/python",
  );
  const python = process.env.VIENEU_PYTHON || (fs.existsSync(localPython) ? localPython : "python");
  const bridge = path.resolve("scripts/lib/tts/vieneu_bridge.py");
  const tempDir = path.resolve("temp/vieneu-tts");
  const modelCache = path.resolve("temp/vieneu-models");
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(modelCache, { recursive: true });
  const child = spawn(python, ["-u", bridge, "--server"], {
    windowsHide: true,
    env: {
      ...process.env,
      HF_HOME: process.env.HF_HOME || modelCache,
      HF_HUB_DISABLE_SYMLINKS_WARNING: process.env.HF_HUB_DISABLE_SYMLINKS_WARNING || "1",
      PYTHONUTF8: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr = `${stderr}${text}`.slice(-8000);
    process.stderr.write(text);
  });
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`VieNeu-TTS: ${message.error}`));
    else request.resolve();
  });
  child.on("error", (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  child.on("close", (code) => {
    if (code === 0 && pending.size === 0) return;
    const error = new Error(`VieNeu-TTS bridge exited with code ${code}.${stderr ? `\n${stderr.trim()}` : ""}`);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });

  return {
    name: "vieneu",
    async synthesize({ text, voice, speed = 0, style = "tin_tuc" }) {
      if (Number(speed) !== 0) {
        throw new Error("VieNeu adapter does not emulate speaking speed. Keep voice.speed=0 and approve pacing from the generated samples.");
      }
      const id = randomUUID();
      const output = path.join(tempDir, `${id}.wav`);
      const done = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(`${JSON.stringify({ id, text, voice, style, output })}\n`);
      await done;
      try {
        return fs.readFileSync(output);
      } finally {
        fs.rmSync(output, { force: true });
      }
    },
    async close() {
      if (!child.killed) child.stdin.end();
    },
  };
}
