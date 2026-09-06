// raw Community API response -> Canonical Farm State (design §8)
import levels from "../data/levels.json" with { type: "json" };

export function levelFromXp(xp) {
  let lvl = 1;
  for (const [level, req] of Object.entries(levels)) {
    const l = Number(level);
    if (!Number.isNaN(l) && typeof req === "number" && xp >= req) lvl = Math.max(lvl, l);
  }
  return lvl;
}

const num = (v) => (v == null ? 0 : Number(v)); // inventory qtys are strings

export function toCanonical(raw) {
  const farm = raw.farm ?? raw; // API may wrap in {farm}
  const bumpkin = farm.bumpkin ?? {};
  const inventory = {};
  for (const [k, v] of Object.entries(farm.inventory ?? {})) inventory[k] = num(v);
  const buildings = {};
  for (const [name, arr] of Object.entries(farm.buildings ?? {})) {
    const b = Array.isArray(arr) ? arr[0] : arr;
    const crafting = b?.crafting ?? [];
    const busyUntil = crafting.length ? Math.max(...crafting.map((c) => c.readyAt ?? 0)) : null;
    buildings[name] = { busyUntil, oil: b?.oil ?? 0 };
  }
  const xp = num(bumpkin.experience);
  return {
    bumpkin: { level: levelFromXp(xp), xp },
    currencies: {
      flower: String(farm.balance ?? "0"), // keep 18-dp string; never float for money
      flowerApprox: Number(farm.balance ?? 0),
      coins: num(farm.coins),
    },
    inventory,
    skills: bumpkin.skills ?? {},
    wearables: bumpkin.equipped ?? {},
    buffs: { vip: (farm.vip?.expiresAt ?? 0) > Date.now(), active: Object.keys(farm.buffs ?? {}) },
    buildings,
    farmActivity: farm.farmActivity ?? {},
    deliveries: farm.delivery?.orders ?? [],
    chores: farm.choreBoard?.chores ?? {},
    bounties: { requests: farm.bounties?.requests ?? [], completed: farm.bounties?.completed ?? [] },
    fetchedAt: Date.now(),
  };
}
