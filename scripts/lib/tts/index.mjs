const providers = {
  vieneu: () => import("./vieneu.mjs"),
  fptai: () => import("./fptai.mjs"),
};

export async function createTtsProvider(name) {
  const key = String(name || "").toLowerCase();
  const load = providers[key];
  if (!load) throw new Error(`Unsupported TTS provider "${name}". Available: ${Object.keys(providers).join(", ")}`);
  const module = await load();
  return module.createProvider();
}

export async function synthesize(options) {
  const provider = await createTtsProvider(options.provider);
  try {
    return await provider.synthesize(options);
  } finally {
    await provider.close?.();
  }
}
