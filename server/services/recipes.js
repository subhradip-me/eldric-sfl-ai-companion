// Dependency expansion: cost AND time (design §15). Pure module, no deps.

const FISH_ITEMS = new Set([
  "Anchovy", "Tuna", "Clownfish", "Blowfish", "Sea Bass", "Halibut", "Porgy",
  "Muskellunge", "Trout", "Napoleanfish", "Tilapia", "Surgeonfish", "Walleye",
  "Rock Blackfish", "Saw Shark", "Hammerhead shark", "Angelfish", "Ray", "Sunfish",
  "Blue Marlin", "Olive Flounder", "Horse Mackerel", "Squid", "Red Snapper", "Butterflyfish"
]);

// Helper to determine the FLOWER market price for any item (including fish and spawn items)
export function getItemPrice(item, prices = {}) {
  if (prices[item] != null && prices[item] > 0) return prices[item];
  // Rod crafting cost: 3 wood + 1 stone (design note from sfl.world/info/cooking)
  const woodPrice = prices["Wood"] ?? 0.0019;
  const stonePrice = prices["Stone"] ?? 0.002;
  const rodCost = 3 * woodPrice + 1 * stonePrice;

  if (FISH_ITEMS.has(item)) return rodCost;
  if (["Fish Stick", "Fish Flake", "Fish Oil", "Crab Stick", "Crab", "Seaweed"].includes(item)) return rodCost;
  if (item === "Magic Mushroom") return 0.008;
  if (item === "Wild Mushroom") return 0.003;
  return null;
}

// Expand a recipe's ingredients to base resources; accumulate intermediate cook time.
export function expand(recipeName, recipes, depth = 0, multiplier = 1) {
  if (depth > 10) throw new Error("dependency cycle: " + recipeName);
  const recipe = recipes[recipeName];
  if (!recipe) return null;
  const base = {};
  let intermediateMinutes = 0;
  const missing = [];
  for (const [ing, baseQty] of Object.entries(recipe.ingredients)) {
    const qty = baseQty * multiplier;
    if (recipes[ing]) {
      const sub = expand(ing, recipes, depth + 1, 1);
      const crafts = qty / (recipes[ing].baseOutput ?? 1);
      for (const [k, v] of Object.entries(sub.base)) base[k] = (base[k] ?? 0) + v * crafts;
      intermediateMinutes += crafts * recipes[ing].baseCookMinutes + sub.intermediateMinutes * crafts;
      missing.push(...sub.missing);
    } else {
      base[ing] = (base[ing] ?? 0) + qty;
    }
  }
  return { base, intermediateMinutes, missing };
}

// FLOWER cost of base resources: both total market value AND out-of-pocket buy cost
export function cost(baseResources, prices = {}, items = {}, inventory = {}) {
  let flower = 0;      // Out-of-pocket FLOWER to buy missing items
  let totalFlower = 0; // Full FLOWER market valuation of all base resources
  const buy = {};
  const mustProduce = {};
  const unpriced = [];

  for (const [item, qty] of Object.entries(baseResources)) {
    const price = getItemPrice(item, prices);
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
 * List all recipes that belong to an active building on the farm,
 * annotated with cookability against the current inventory.
 *
 * @param {object} allRecipes  - the full recipes.json object
 * @param {string[]} activeBuildings - buildings present on the farm (e.g. from canonical.buildings)
 * @param {object} inventory   - farm inventory { "Carrot": 120, ... }
 * @returns {object[]} array of recipe entries sorted by building then name, each with:
 *   - name, building, baseXp, baseCookMinutes, instantGems, ingredients
 *   - canCook {boolean} — true if inventory covers every direct ingredient
 *   - missingIngredients {object} — { "Egg": { need: 10, have: 3, short: 7 } } (only missing ones)
 *   - isIntermediate {boolean} — true if this recipe is typically used as an ingredient
 */
export function list_recipes(allRecipes, activeBuildings, inventory = {}) {
  const intermediates = new Set(allRecipes._meta?.intermediates ?? []);
  const buildingSet = new Set(activeBuildings);
  const results = [];

  for (const [name, recipe] of Object.entries(allRecipes)) {
    // Skip meta key and recipes whose building isn't active on this farm
    if (name.startsWith("_") || !recipe.building) continue;
    if (!buildingSet.has(recipe.building)) continue;

    // Check direct-ingredient cookability against inventory
    const missingIngredients = {};
    let canCook = true;
    for (const [ing, qty] of Object.entries(recipe.ingredients)) {
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

  // Sort: building alpha, then canCook first, then name
  results.sort((a, b) => {
    if (a.building !== b.building) return a.building.localeCompare(b.building);
    if (a.canCook !== b.canCook) return a.canCook ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
}
