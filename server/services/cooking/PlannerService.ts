/**
 * PlannerService — per-building cooking optimiser (design §17).
 * Picks the best XP/FLOWER recipe per building and checks daily affordability.
 */
import type { CanonicalFarmState, CookingPlan, MarketPrice } from '../../types/index.js';
import { xpEngine } from './XpEngine.js';
import { recipeService } from './RecipeService.js';

const L100 = 24_083_905;

export class PlannerService {
  /**
   * Build the optimised cooking plan for a canonical farm state.
   * @param farm      - canonical farm state from SunflowerClient
   * @param prices    - live P2P market prices
   * @param recipes   - full recipes.json object
   * @param items     - items.json (tradability metadata)
   * @param modifiers - modifiers.json (custom skill overrides)
   */
  plan(
    farm: CanonicalFarmState,
    prices: MarketPrice,
    recipes: Record<string, unknown>,
    items: Record<string, unknown>,
    modifiers: Record<string, unknown>
  ): CookingPlan {
    const remaining = Math.max(L100 - farm.bumpkin.xp, 0);
    const intermediates = new Set<string>(
      (recipes['_meta'] as { intermediates?: string[] })?.intermediates ?? ['Cheese']
    );
    const perBuilding: Record<string, import('../../types/index.js').CookingPlanCandidate & { building?: string }> = {};

    for (const [name, recipe] of Object.entries(recipes)) {
      if (name.startsWith('_') || intermediates.has(name)) continue;
      const r = recipe as import('../../types/index.js').RecipeDefinition;
      if (!(r.building in farm.buildings)) continue;

      const eff = xpEngine.effective(name, r, farm, modifiers);
      const dep = recipeService.expand(name, recipes as Parameters<typeof recipeService.expand>[1], 0, eff.ingredientMultiplier ?? 1);
      const c = recipeService.cost(dep.base, prices, items as Parameters<typeof recipeService.cost>[2], farm.inventory);
      const totalMinutes = eff.minutes + dep.intermediateMinutes;
      const marketFlower = c.totalFlower > 0 ? c.totalFlower : c.flower > 0 ? c.flower : 0.0001;
      const flowerCost = +marketFlower.toFixed(5);
      const flowerToBuy = +c.flower.toFixed(5);
      const batchesToLevel100 = Math.ceil(remaining / eff.batchXp);
      const totalMilestoneFlower = +(batchesToLevel100 * flowerCost).toFixed(2);

      const cand = {
        recipe: name,
        verified: !!r.verified,
        batchXp: eff.batchXp,
        flowerCost,
        flowerToBuy,
        buy: c.buy,
        mustProduce: c.mustProduce,
        totalMinutes,
        xpPerFlower: Math.round(eff.batchXp / marketFlower),
        xpPerHour: Math.round(eff.batchXp / (totalMinutes / 60)),
        modifiers: eff.applied,
        batchesToLevel100,
        totalMilestoneFlower,
      };

      const cur = perBuilding[r.building];
      if (!cur || cand.xpPerFlower > cur.xpPerFlower) perBuilding[r.building] = cand;
    }

    const buildings = Object.entries(perBuilding).map(([building, r]) => ({ building, ...r }));
    const best = buildings
      .filter((b) => isFinite(b.xpPerFlower) && b.xpPerFlower > 0)
      .sort((a, b) => b.xpPerFlower - a.xpPerFlower)[0];

    const batchesNeeded = best ? Math.ceil(remaining / best.batchXp) : null;
    const estimatedFlower = best ? +(batchesNeeded! * best.flowerCost).toFixed(2) : null;
    const balance = farm.currencies.flowerApprox;
    const dailyCost = buildings.reduce((s, b) => s + (b.flowerToBuy ?? b.flowerCost), 0);
    const affordable = balance >= dailyCost;

    const notes: string[] = [];
    if (!affordable)
      notes.push(
        `Cannot afford today's 1-batch plan (~${dailyCost.toFixed(2)} FLOWER out-of-pocket needed today, ${balance} available). Earn FLOWER first — greenhouse crops (Grape/Rice/Olive) and deliveries.`
      );
    if (estimatedFlower != null && estimatedFlower > balance)
      notes.push(
        `Level 100 via ${best!.recipe}: ~${batchesNeeded} batches ≈ ${estimatedFlower} FLOWER total (${best!.flowerCost} FLOWER/batch) — far above current balance.`
      );

    const farmList = [...new Set(buildings.flatMap((b) => Object.keys(b.mustProduce)))];
    const buyList = [...new Set(buildings.flatMap((b) => Object.keys(b.buy)))];

    return {
      target: { level: 100, xp: L100, remaining },
      affordable,
      budget: { flower: farm.currencies.flower, coins: farm.currencies.coins },
      buildings,
      farm: farmList,
      buy: buyList,
      estimate: best
        ? {
            batches: batchesNeeded!,
            flower: estimatedFlower!,
            recipe: best.recipe,
            building: best.building!,
            totalMilestoneFlower: best.totalMilestoneFlower,
          }
        : undefined,
      notes,
    };
  }
}

export const plannerService = new PlannerService();
