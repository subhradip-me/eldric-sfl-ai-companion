/**
 * RecipeService — dependency expansion, cost computation, and recipe listing (design §15).
 * Pure class, no I/O.
 */
import type { CostResult, MarketPrice } from '../../types/index.js';

const FISH_ITEMS = new Set([
  'Anchovy', 'Tuna', 'Clownfish', 'Blowfish', 'Sea Bass', 'Halibut', 'Porgy',
  'Muskellunge', 'Trout', 'Napoleanfish', 'Tilapia', 'Surgeonfish', 'Walleye',
  'Rock Blackfish', 'Saw Shark', 'Hammerhead shark', 'Angelfish', 'Ray', 'Sunfish',
  'Blue Marlin', 'Olive Flounder', 'Horse Mackerel', 'Squid', 'Red Snapper', 'Butterflyfish',
]);

interface ExpandResult {
  base: Record<string, number>;
  intermediateMinutes: number;
  missing: string[];
}

export class RecipeService {
  /**
   * Determine the FLOWER market price for any item (including fish and spawn items).
   * Falls back to rod-crafting cost for fish when no direct price is available.
   */
  getItemPrice(item: string, prices: MarketPrice = {}): number | null {
    if (prices[item] != null && prices[item] > 0) return prices[item];
    const woodPrice = prices['Wood'] ?? 0.0019;
    const stonePrice = prices['Stone'] ?? 0.002;
    const rodCost = 3 * woodPrice + 1 * stonePrice;
    if (FISH_ITEMS.has(item)) return rodCost;
    if (['Fish Stick', 'Fish Flake', 'Fish Oil', 'Crab Stick', 'Crab', 'Seaweed'].includes(item)) return rodCost;
    if (item === 'Magic Mushroom') return 0.008;
    if (item === 'Wild Mushroom') return 0.003;
    return null;
  }

  /**
   * Recursively expand a recipe's ingredients to base resources and
   * accumulate intermediate cook time.
   */
  expand(
    recipeName: string,
    recipes: Record<string, { ingredients: Record<string, number>; baseOutput?: number; baseCookMinutes?: number }>,
    depth = 0,
    multiplier = 1
  ): ExpandResult {
    if (depth > 10) throw new Error('dependency cycle: ' + recipeName);
    const recipe = recipes[recipeName];
    if (!recipe) return { base: {}, intermediateMinutes: 0, missing: [recipeName] };
    const base: Record<string, number> = {};
    let intermediateMinutes = 0;
    const missing: string[] = [];
    for (const [ing, baseQty] of Object.entries(recipe.ingredients)) {
      const qty = baseQty * multiplier;
      if (recipes[ing]) {
        const sub = this.expand(ing, recipes, depth + 1, 1);
        const crafts = qty / (recipes[ing].baseOutput ?? 1);
        for (const [k, v] of Object.entries(sub.base)) base[k] = (base[k] ?? 0) + v * crafts;
        intermediateMinutes += crafts * (recipes[ing].baseCookMinutes ?? 0) + sub.intermediateMinutes * crafts;
        missing.push(...sub.missing);
      } else {
        base[ing] = (base[ing] ?? 0) + qty;
      }
    }
    return { base, intermediateMinutes, missing };
  }

  /**
   * Compute FLOWER cost of base resources — both total market value
   * and the out-of-pocket buy cost given current inventory.
   */
  cost(
    baseResources: Record<string, number>,
    prices: MarketPrice = {},
    items: Record<string, { tradable?: boolean }> = {},
    inventory: Record<string, number> = {}
  ): CostResult {
    let flower = 0;
    let totalFlower = 0;
    const buy: Record<string, number> = {};
    const mustProduce: Record<string, number> = {};
    const unpriced: string[] = [];

    for (const [item, qty] of Object.entries(baseResources)) {
      const price = this.getItemPrice(item, prices);
      if (price != null) {
        totalFlower += qty * price;
      } else {
        unpriced.push(item);
      }

      const toBuy = Math.max(qty - (inventory[item] ?? 0), 0);
      if (toBuy === 0) continue;

      const meta = items[item];
      if (meta && meta.tradable === false) {
        mustProduce[item] = toBuy;
      } else if (prices[item] == null) {
        mustProduce[item] = toBuy;
      } else {
        buy[item] = toBuy;
        flower += toBuy * prices[item];
      }
    }

    return { flower, totalFlower, buy, mustProduce, unpriced };
  }

  /**
   * List all recipes for a farm's active buildings, annotated with
   * cookability against current inventory.
   */
  listRecipes(
    allRecipes: Record<string, { building?: string; baseXp?: number; baseCookMinutes?: number; instantGems?: number; ingredients?: Record<string, number>; verified?: boolean }>,
    activeBuildings: string[],
    inventory: Record<string, number> = {}
  ): Array<{
    name: string;
    building: string;
    baseXp?: number;
    baseCookMinutes?: number;
    instantGems?: number;
    ingredients?: Record<string, number>;
    verified: boolean;
    isIntermediate: boolean;
    canCook: boolean;
    missingIngredients: Record<string, { need: number; have: number; short: number }>;
  }> {
    const intermediates = new Set<string>((allRecipes['_meta'] as { intermediates?: string[] })?.intermediates ?? []);
    const buildingSet = new Set(activeBuildings);
    const results: ReturnType<typeof this.listRecipes> = [];

    for (const [name, recipe] of Object.entries(allRecipes)) {
      if (name.startsWith('_') || !recipe.building) continue;
      if (!buildingSet.has(recipe.building)) continue;

      const missingIngredients: Record<string, { need: number; have: number; short: number }> = {};
      let canCook = true;
      for (const [ing, qty] of Object.entries(recipe.ingredients ?? {})) {
        const have = Number(inventory[ing] ?? 0);
        if (have < qty) {
          canCook = false;
          missingIngredients[ing] = { need: qty, have, short: qty - have };
        }
      }

      results.push({
        name,
        building: recipe.building,
        baseXp: recipe.baseXp,
        baseCookMinutes: recipe.baseCookMinutes,
        instantGems: recipe.instantGems,
        ingredients: recipe.ingredients,
        verified: !!recipe.verified,
        isIntermediate: intermediates.has(name),
        canCook,
        missingIngredients,
      });
    }

    results.sort((a, b) => {
      if (a.building !== b.building) return a.building.localeCompare(b.building);
      if (a.canCook !== b.canCook) return a.canCook ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  /** Alias for backward compatibility */
  list_recipes(
    allRecipes: Record<string, { building?: string; baseXp?: number; baseCookMinutes?: number; instantGems?: number; ingredients?: Record<string, number>; verified?: boolean }>,
    activeBuildings: string[],
    inventory: Record<string, number> = {}
  ) {
    return this.listRecipes(allRecipes, activeBuildings, inventory);
  }
}

export const recipeService = new RecipeService();
