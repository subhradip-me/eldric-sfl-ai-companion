// farmActivity deltas = Observed; inventory deltas = Inferred (design §12). Pure module.
export function diffActivity(prev, curr) {
  const observed = {};
  for (const [k, v] of Object.entries(curr.farmActivity ?? {})) {
    const d = v - (prev.farmActivity?.[k] ?? 0);
    if (d !== 0) observed[k] = d;
  }
  const inferred = {};
  const keys = new Set([...Object.keys(prev.inventory ?? {}), ...Object.keys(curr.inventory ?? {})]);
  for (const k of keys) {
    const d = (curr.inventory?.[k] ?? 0) - (prev.inventory?.[k] ?? 0);
    if (Math.abs(d) > 1e-9) inferred[k] = +d.toFixed(4);
  }
  return {
    observed,   // exact counter movements
    inferred,   // inventory movement (validation/fallback only)
    xpDelta: (curr.bumpkin?.xp ?? 0) - (prev.bumpkin?.xp ?? 0),
    from: prev.fetchedAt, to: curr.fetchedAt,
  };
}
