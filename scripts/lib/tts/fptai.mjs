const ENDPOINT = "https://api.fpt.ai/hmi/tts/v5";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createProvider() {
  const apiKey = process.env.FPT_AI_API_KEY;
  if (!apiKey) throw new Error("FPT_AI_API_KEY is required for voice.provider=fptai");
  return {
    name: "fptai",
    async synthesize({ text, voice = "leminh", speed = 0 }) {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          api_key: apiKey,
          voice: String(voice),
          speed: String(speed),
          format: "wav",
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: text,
      });
      if (!response.ok) throw new Error(`FPT.AI request failed: HTTP ${response.status} ${await response.text()}`);
      const payload = await response.json();
      if (Number(payload.error) !== 0 || !payload.async) {
        throw new Error(`FPT.AI rejected request: ${payload.message || JSON.stringify(payload)}`);
      }
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const audio = await fetch(payload.async);
        if (audio.ok) {
          const bytes = Buffer.from(await audio.arrayBuffer());
          if (bytes.length > 1024) return bytes;
        }
        await wait(3000);
      }
      throw new Error(`FPT.AI audio was not ready within 120 seconds (request ${payload.request_id || "unknown"})`);
    },
    async close() {},
  };
}
