// Per-building planner + affordability gate (design §17). Pure module.
import { expand, cost } from "./recipes.js";
import { effective } from "./xpEngine.js";

const L100 = 24083905;

export function plan(farm, prices, recipes, items, modifiers) {
  const remaining = Math.max(L100 - farm.bumpkin.xp, 0);
  const perBuilding = {};
  for (const [name, recipe] of Object.entries(recipes)) {
    if (name.startsWith("_") || name === "Cheese") continue; // intermediates aren't goals
    if (!(recipe.building in farm.buildings)) continue;
    const eff = effective(name, recipe, farm, modifiers);
    const dep = expand(name, recipes);
    const c = cost(dep.base, prices, items, farm.inventory);
    const totalMinutes = eff.minutes + dep.intermediateMinutes;
    const cand = {
      recipe: name, verified: !!recipe.verified, batchXp: eff.batchXp,
      flowerCost: +c.flower.toFixed(5), buy: c.buy, mustProduce: c.mustProduce,
      totalMinutes, xpPerFlower: c.flower > 0 ? eff.batchXp / c.flower : Infinity,
      xpPerHour: eff.batchXp / (totalMinutes / 60), modifiers: eff.applied,
    };
    const cur = perBuilding[recipe.building];
    if (!cur || cand.xpPerFlower > cur.xpPerFlower) perBuilding[recipe.building] = cand;
  }
  const buildings = Object.entries(perBuilding).map(([building, r]) => ({ building, ...r }));
  // Level-100 estimate using best xp/FLOWER candidate
  const best = buildings.filter((b) => isFinite(b.xpPerFlower)).sort((a, b) => b.xpPerFlower - a.xpPerFlower)[0];
  const batchesNeeded = best ? Math.ceil(remaining / best.batchXp) : null;
  const estimatedFlower = best ? +(batchesNeeded * best.flowerCost).toFixed(2) : null;
  const balance = farm.currencies.flowerApprox;
  const dailyCost = buildings.reduce((s, b) => s + b.flowerCost, 0);
  const affordable = balance >= dailyCost;
  const notes = [];
  if (!affordable) notes.push(`Cannot afford today's plan (~${dailyCost.toFixed(2)} FLOWER needed, ${balance} available). Earn FLOWER first — greenhouse crops (Grape/Rice/Olive) and deliveries.`);
  if (estimatedFlower != null && estimatedFlower > balance) notes.push(`Level 100 via ${best.recipe}: ~${batchesNeeded} batches ≈ ${estimatedFlower} FLOWER — far above current balance.`);
  const farmList = [...new Set(buildings.flatMap((b) => Object.keys(b.mustProduce)))];
  const buyList = [...new Set(buildings.flatMap((b) => Object.keys(b.buy)))];
  return {
    target: { level: 100, xp: L100, remaining },
    affordable,
    budget: { flower: farm.currencies.flower, coins: farm.currencies.coins },
    buildings, farm: farmList, buy: buyList,
    estimate: best ? { recipe: best.recipe, batchesNeeded, estimatedFlower } : null,
    notes,
  };
}
