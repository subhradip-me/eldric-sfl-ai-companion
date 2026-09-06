// Dependency expansion: cost AND time (design §15). Pure module, no deps.

// Expand a recipe's ingredients to base resources; accumulate intermediate cook time.
export function expand(recipeName, recipes, depth = 0) {
  if (depth > 10) throw new Error("dependency cycle: " + recipeName);
  const recipe = recipes[recipeName];
  if (!recipe) return null;
  const base = {};
  let intermediateMinutes = 0;
  const missing = [];
  for (const [ing, qty] of Object.entries(recipe.ingredients)) {
    if (recipes[ing]) {
      const sub = expand(ing, recipes, depth + 1);
      const crafts = qty / recipes[ing].baseOutput;
      for (const [k, v] of Object.entries(sub.base)) base[k] = (base[k] ?? 0) + v * crafts;
      intermediateMinutes += crafts * recipes[ing].baseCookMinutes + sub.intermediateMinutes * crafts;
      missing.push(...sub.missing);
    } else {
      base[ing] = (base[ing] ?? 0) + qty;
    }
  }
  return { base, intermediateMinutes, missing };
}

// FLOWER cost of base resources after inventory offset. Untradable gaps -> mustProduce.
export function cost(baseResources, prices, items, inventory = {}) {
  let flower = 0;
  const buy = {};
  const mustProduce = {};
  const unpriced = [];
  for (const [item, qty] of Object.entries(baseResources)) {
    const toBuy = Math.max(qty - (inventory[item] ?? 0), 0);
    if (toBuy === 0) continue;
    const meta = items[item];
    const price = prices[item];
    if (meta && meta.tradable === false) mustProduce[item] = toBuy;
    else if (price == null) { unpriced.push(item); mustProduce[item] = toBuy; }
    else { buy[item] = toBuy; flower += toBuy * price; }
  }
  return { flower, buy, mustProduce, unpriced };
}
