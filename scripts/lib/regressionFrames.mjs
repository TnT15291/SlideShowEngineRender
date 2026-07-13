export function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

export function compareRegression(current, baseline, { reviewAt = 9, changedAt = 19 } = {}) {
  if (!baseline) return { verdict: "new", frames: [] };
  const frames = current.frames.map((frame) => {
    const old = baseline.frames.find((f) => f.beat === frame.beat);
    const distance = hammingHex(frame.hash, old?.hash);
    return { beat: frame.beat, distance, verdict: distance >= changedAt ? "changed" : distance >= reviewAt ? "review" : "pass" };
  });
  const structuralChange = current.signature !== baseline.signature;
  return { verdict: structuralChange || frames.some((f) => f.verdict === "changed") ? "changed" : frames.some((f) => f.verdict === "review") ? "review" : "pass",
    structuralChange, frames };
}
